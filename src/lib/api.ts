import {
  collection,
  doc,
  query,
  where,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, auth, storage } from '../firebase';
import { Artwork, Layer, CanvasBounds, PerspectivePoint } from '../types';
import { createStorageObjectPath } from './workflow';

async function getAuthToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Unauthenticated: User is not signed in.');
  }
  return user.getIdToken();
}

export function subscribeToArtworks(
  userId: string,
  callback: (artworks: Artwork[]) => void,
  onError: (error: Error) => void,
) {
  const q = query(collection(db, 'artworks'), where('ownerId', '==', userId));
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs
        .map((document) => ({ id: document.id, ...document.data() } as Artwork))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      callback(list);
    },
    onError,
  );
}

export async function createArtwork(title: string, description?: string): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Unauthenticated');

  const docRef = doc(collection(db, 'artworks'));
  const now = new Date().toISOString();
  const data: {
    title: string;
    ownerId: string;
    status: 'in_progress';
    createdAt: string;
    updatedAt: string;
    description?: string;
  } = {
    title,
    ownerId: user.uid,
    status: 'in_progress',
    createdAt: now,
    updatedAt: now,
  };
  if (description) data.description = description;

  await setDoc(docRef, data);
  return docRef.id;
}

export function subscribeToLayers(
  artworkId: string,
  callback: (layers: Layer[]) => void,
  onError: (error: Error) => void,
) {
  const q = query(collection(db, `artworks/${artworkId}/layers`));
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs
        .map((document) => ({ id: document.id, ...document.data() } as Layer))
        .sort((a, b) => {
          const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
          const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
          if (orderA !== orderB) return orderA - orderB;
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        });
      callback(list);
    },
    onError,
  );
}

function imageExtension(contentType: string): string {
  switch (contentType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      throw new Error(`Unsupported image content type: ${contentType || '(empty)'}`);
  }
}

async function uploadImageToStorage(artworkId: string, imageBlob: Blob): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Unauthenticated');

  const filename = `${crypto.randomUUID()}.${imageExtension(imageBlob.type)}`;
  const storagePath = createStorageObjectPath(user.uid, artworkId, filename);
  const storageRef = ref(storage, storagePath);
  const snapshot = await uploadBytes(storageRef, imageBlob, { contentType: imageBlob.type });
  return getDownloadURL(snapshot.ref);
}

async function deleteStorageImage(imageUrl: string): Promise<void> {
  const isFirebaseUrl =
    imageUrl.startsWith('gs://') ||
    imageUrl.startsWith('https://firebasestorage.googleapis.com/') ||
    imageUrl.startsWith('https://storage.googleapis.com/');
  if (!isFirebaseUrl) {
    throw new Error(`Unsupported stored image URL: ${imageUrl}`);
  }
  await deleteObject(ref(storage, imageUrl));
}

async function rollbackUploadedImage(imageUrl: string, cause: unknown): Promise<never> {
  try {
    await deleteStorageImage(imageUrl);
  } catch (rollbackError) {
    throw new AggregateError(
      [cause, rollbackError],
      'Layer persistence failed and the uploaded image rollback also failed.',
    );
  }
  throw cause;
}

export async function createLayer(
  artworkId: string,
  imageBlob: Blob,
  notes?: string,
  techniques: string[] = [],
  colorPaletteSuggestions: string[] = [],
  customCreatedAt?: string,
  order?: number,
): Promise<string> {
  if (!auth.currentUser) throw new Error('Unauthenticated');

  const imageUrl = await uploadImageToStorage(artworkId, imageBlob);
  const batch = writeBatch(db);
  const layerDocRef = doc(collection(db, `artworks/${artworkId}/layers`));
  const now = new Date().toISOString();
  const layerData: {
    imageUrl: string;
    techniques: string[];
    colorPaletteSuggestions: string[];
    createdAt: string;
    notes?: string;
    order?: number;
  } = {
    imageUrl,
    techniques,
    colorPaletteSuggestions,
    createdAt: customCreatedAt ?? now,
  };
  if (notes) layerData.notes = notes;
  if (order !== undefined) layerData.order = order;

  batch.set(layerDocRef, layerData);
  batch.update(doc(db, 'artworks', artworkId), { updatedAt: now });

  try {
    await batch.commit();
  } catch (error) {
    return rollbackUploadedImage(imageUrl, error);
  }
  return layerDocRef.id;
}

export async function replaceLayerImage(
  artworkId: string,
  layerId: string,
  imageBlob: Blob,
  previousImageUrl: string,
): Promise<string> {
  const imageUrl = await uploadImageToStorage(artworkId, imageBlob);
  try {
    await updateDoc(doc(db, `artworks/${artworkId}/layers`, layerId), { imageUrl });
  } catch (error) {
    return rollbackUploadedImage(imageUrl, error);
  }

  if (previousImageUrl !== imageUrl) await deleteStorageImage(previousImageUrl);
  return imageUrl;
}

export async function updateLayersOrder(
  artworkId: string,
  layersWithNewOrder: { id: string; order: number }[],
): Promise<void> {
  const batch = writeBatch(db);
  layersWithNewOrder.forEach((item) => {
    batch.update(doc(db, `artworks/${artworkId}/layers`, item.id), { order: item.order });
  });
  await batch.commit();
}

export async function deleteLayer(artworkId: string, layerId: string, imageUrl: string): Promise<void> {
  await deleteDoc(doc(db, `artworks/${artworkId}/layers`, layerId));
  await deleteStorageImage(imageUrl);
}

export async function deleteArtworkComplete(artworkId: string): Promise<void> {
  if (!auth.currentUser) throw new Error('Unauthenticated');

  const layersSnap = await getDocs(collection(db, `artworks/${artworkId}/layers`));
  const layers = layersSnap.docs.map((document) => ({ id: document.id, ...document.data() } as Layer));

  const batch = writeBatch(db);
  for (const layer of layers) batch.delete(doc(db, `artworks/${artworkId}/layers`, layer.id));
  batch.delete(doc(db, 'artworks', artworkId));
  await batch.commit();

  const cleanupResults = await Promise.allSettled(layers.map((layer) => deleteStorageImage(layer.imageUrl)));
  const cleanupErrors = cleanupResults
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason);
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'Artwork was deleted, but one or more stored images could not be removed.');
  }
}

export async function detectCanvasBoundsApi(
  fileOrBlob: File | Blob,
  method: 'opencv' | 'gemini',
): Promise<{ bounds: CanvasBounds; mode: string }> {
  const token = await getAuthToken();
  const formData = new FormData();
  formData.append('file', fileOrBlob);
  formData.append('method', method);

  const res = await fetch('/api/detect-canvas-bounds', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Failed to detect canvas bounds');
  return { bounds: data.bounds, mode: data.mode };
}

export async function perspectiveWarpApi(fileOrBlob: File | Blob, points: PerspectivePoint[]): Promise<Blob> {
  const token = await getAuthToken();
  const formData = new FormData();
  formData.append('file', fileOrBlob);
  formData.append('points', JSON.stringify(points));

  const res = await fetch('/api/perspective-warp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.error || 'Perspective warp failed');
  }
  return res.blob();
}

export async function alignMilestonesApi(
  targetFileOrBlob: File | Blob,
  baseFileOrBlob: File | Blob,
): Promise<Blob> {
  const token = await getAuthToken();
  const formData = new FormData();
  formData.append('target', targetFileOrBlob);
  formData.append('base', baseFileOrBlob);

  const res = await fetch('/api/align', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.error || 'Milestone alignment failed');
  }
  return res.blob();
}
