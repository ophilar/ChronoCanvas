import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from '../firebase';
import { Artwork, CanvasBounds, Layer, PerspectivePoint } from '../types';
import { createStorageObjectPath } from './workflow';

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) throw new Error(`Server returned an empty ${response.status} response.`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Server returned invalid JSON with status ${response.status}.`, { cause: error });
  }
  return record(parsed);
}

function responseErrorFromData(
  response: Response,
  data: Record<string, unknown>,
  operation: string,
): Error {
  const message =
    typeof data.error === 'string'
      ? data.error
      : `${operation} failed with status ${response.status}.`;
  return new Error(message);
}

async function responseError(response: Response, operation: string): Promise<Error> {
  const data = await readJsonObject(response);
  return responseErrorFromData(response, data, operation);
}

async function getAuthToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Unauthenticated: user is not signed in.');
  return user.getIdToken();
}

export function subscribeToArtworks(
  userId: string,
  callback: (artworks: Artwork[]) => void,
  onError: (error: Error) => void,
) {
  const artworksQuery = query(collection(db, 'artworks'), where('ownerId', '==', userId));
  return onSnapshot(
    artworksQuery,
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

  const artworkRef = doc(collection(db, 'artworks'));
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

  await setDoc(artworkRef, data);
  return artworkRef.id;
}

export function subscribeToLayers(
  artworkId: string,
  callback: (layers: Layer[]) => void,
  onError: (error: Error) => void,
) {
  const layersQuery = query(collection(db, `artworks/${artworkId}/layers`));
  return onSnapshot(
    layersQuery,
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
  if (!isFirebaseUrl) throw new Error(`Unsupported stored image URL: ${imageUrl}`);
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
  const layerRef = doc(collection(db, `artworks/${artworkId}/layers`));
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

  batch.set(layerRef, layerData);
  batch.update(doc(db, 'artworks', artworkId), { updatedAt: now });

  try {
    await batch.commit();
  } catch (error) {
    return rollbackUploadedImage(imageUrl, error);
  }
  return layerRef.id;
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
  for (const item of layersWithNewOrder) {
    batch.update(doc(db, `artworks/${artworkId}/layers`, item.id), { order: item.order });
  }
  await batch.commit();
}

export async function deleteLayer(
  artworkId: string,
  layerId: string,
  imageUrl: string,
): Promise<void> {
  await deleteDoc(doc(db, `artworks/${artworkId}/layers`, layerId));
  await deleteStorageImage(imageUrl);
}

export async function deleteArtworkComplete(artworkId: string): Promise<void> {
  if (!auth.currentUser) throw new Error('Unauthenticated');

  const layersSnapshot = await getDocs(collection(db, `artworks/${artworkId}/layers`));
  const layers = layersSnapshot.docs.map(
    (document) => ({ id: document.id, ...document.data() }) as Layer,
  );

  const batch = writeBatch(db);
  for (const layer of layers) batch.delete(doc(db, `artworks/${artworkId}/layers`, layer.id));
  batch.delete(doc(db, 'artworks', artworkId));
  await batch.commit();

  const cleanupResults = await Promise.allSettled(
    layers.map((layer) => deleteStorageImage(layer.imageUrl)),
  );
  const cleanupErrors = cleanupResults
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason);
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      'Artwork was deleted, but one or more stored images could not be removed.',
    );
  }
}

export async function detectCanvasBoundsApi(
  fileOrBlob: File | Blob,
  method: 'opencv' | 'gemini',
): Promise<{ bounds: CanvasBounds; mode: 'opencv' | 'gemini' }> {
  const token = await getAuthToken();
  const formData = new FormData();
  formData.append('file', fileOrBlob);
  formData.append('method', method);

  const response = await fetch('/api/detect-canvas-bounds', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const data = await readJsonObject(response);
  if (!response.ok || data.success !== true) {
    throw responseErrorFromData(response, data, 'Canvas detection');
  }
  if (data.mode !== 'opencv' && data.mode !== 'gemini') {
    throw new Error('Canvas detection returned an invalid mode.');
  }

  const bounds = record(data.bounds);
  const { ymin, xmin, ymax, xmax } = bounds;
  if (
    typeof ymin !== 'number' ||
    typeof xmin !== 'number' ||
    typeof ymax !== 'number' ||
    typeof xmax !== 'number'
  ) {
    throw new Error('Canvas detection returned invalid bounds.');
  }

  return {
    bounds: { ymin, xmin, ymax, xmax },
    mode: data.mode,
  };
}

export async function perspectiveWarpApi(
  fileOrBlob: File | Blob,
  points: PerspectivePoint[],
): Promise<Blob> {
  const token = await getAuthToken();
  const formData = new FormData();
  formData.append('file', fileOrBlob);
  formData.append('points', JSON.stringify(points));

  const response = await fetch('/api/perspective-warp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!response.ok) throw await responseError(response, 'Perspective warp');
  return response.blob();
}

export async function alignMilestonesApi(
  targetFileOrBlob: File | Blob,
  baseFileOrBlob: File | Blob,
): Promise<Blob> {
  const token = await getAuthToken();
  const formData = new FormData();
  formData.append('target', targetFileOrBlob);
  formData.append('base', baseFileOrBlob);

  const response = await fetch('/api/align', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!response.ok) throw await responseError(response, 'Milestone alignment');
  return response.blob();
}
