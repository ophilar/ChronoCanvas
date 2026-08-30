import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { z } from 'zod';
import { auth, db, storage } from '../firebase';
import type { Artwork, CanvasBounds, Layer, PerspectivePoint } from '../types';
import { parseArtworkDocument, parseLayerDocument } from './firestoreModels';
import { createStorageObjectPath } from './workflow';

const errorResponseSchema = z.object({ error: z.string().min(1) }).strict();
const canvasDetectionResponseSchema = z
  .object({
    success: z.literal(true),
    mode: z.enum(['opencv', 'gemini']),
    bounds: z
      .object({
        ymin: z.number().finite().min(0).max(1),
        xmin: z.number().finite().min(0).max(1),
        ymax: z.number().finite().min(0).max(1),
        xmax: z.number().finite().min(0).max(1),
        centerX: z.number().finite().min(0).max(1),
        centerY: z.number().finite().min(0).max(1),
        width: z.number().finite().positive().max(1),
        height: z.number().finite().positive().max(1),
      })
      .strict()
      .refine((bounds) => bounds.xmin < bounds.xmax && bounds.ymin < bounds.ymax, {
        message: 'Canvas bounds must have positive normalized extents.',
      }),
  })
  .strict();

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) throw new Error(`Server returned an empty ${response.status} response.`);

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Server returned invalid JSON with status ${response.status}.`, { cause: error });
  }
}

async function responseError(response: Response, operation: string): Promise<Error> {
  const parsed = errorResponseSchema.safeParse(await readJson(response));
  if (!parsed.success) {
    return new Error(`${operation} returned an invalid error response with status ${response.status}.`, {
      cause: parsed.error,
    });
  }
  return new Error(parsed.data.error);
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
      try {
        const list = snapshot.docs
          .map((document) => parseArtworkDocument(document.id, document.data()))
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        callback(list);
      } catch (error) {
        onError(asError(error));
      }
    },
    onError,
  );
}

export async function getArtwork(artworkId: string): Promise<Artwork | null> {
  const snapshot = await getDoc(doc(db, 'artworks', artworkId));
  return snapshot.exists() ? parseArtworkDocument(snapshot.id, snapshot.data()) : null;
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
      try {
        const list = snapshot.docs
          .map((document) => parseLayerDocument(document.id, document.data()))
          .sort((a, b) => {
            const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
            const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
            if (orderA !== orderB) return orderA - orderB;
            return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          });
        callback(list);
      } catch (error) {
        onError(asError(error));
      }
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
  const layers = layersSnapshot.docs.map((document) =>
    parseLayerDocument(document.id, document.data()),
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
  if (!response.ok) throw await responseError(response, 'Canvas detection');

  const data = canvasDetectionResponseSchema.parse(await readJson(response));
  return {
    bounds: {
      ymin: data.bounds.ymin,
      xmin: data.bounds.xmin,
      ymax: data.bounds.ymax,
      xmax: data.bounds.xmax,
    },
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
