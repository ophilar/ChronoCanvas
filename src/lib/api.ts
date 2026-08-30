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
  serverTimestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, auth, storage } from '../firebase';
import { Artwork, Layer, CanvasBounds, PerspectivePoint } from '../types';

/**
 * Helper to get current user's Firebase ID token for backend authentication
 */
async function getAuthToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Unauthenticated: User is not signed in.');
  }
  return user.getIdToken();
}

// ==========================================
// Firestore Artworks Collection API
// ==========================================

export function subscribeToArtworks(userId: string, callback: (artworks: Artwork[]) => void) {
  const q = query(collection(db, 'artworks'), where('ownerId', '==', userId));
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() } as Artwork))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      callback(list);
    },
    (error) => {
      console.error('Firestore subscribeToArtworks error:', error);
      throw error;
    }
  );
}

export async function createArtwork(title: string, description?: string): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Unauthenticated');

  const docRef = doc(collection(db, 'artworks'));
  const now = new Date().toISOString();
  const data: Record<string, any> = {
    title,
    ownerId: user.uid,
    status: 'in_progress',
    createdAt: now,
    updatedAt: now,
  };
  if (description) {
    data.description = description;
  }

  await setDoc(docRef, data);
  return docRef.id;
}

// ==========================================
// Firestore Layers Subcollection API
// ==========================================

export function subscribeToLayers(artworkId: string, userId: string, callback: (layers: Layer[]) => void) {
  const q = query(collection(db, `artworks/${artworkId}/layers`), where('ownerId', '==', userId));
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() } as Layer))
        .sort((a, b) => {
          const orderA = a.order !== undefined ? a.order : Number.MAX_SAFE_INTEGER;
          const orderB = b.order !== undefined ? b.order : Number.MAX_SAFE_INTEGER;
          if (orderA !== orderB) {
            return orderA - orderB;
          }
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        });
      callback(list);
    },
    (error) => {
      console.error(`Firestore subscribeToLayers error on artworks/${artworkId}/layers:`, error);
      throw error;
    }
  );
}

/**
 * Uploads an image blob to Firebase Storage and returns its durable public download URL
 */
export async function uploadImageToStorage(artworkId: string, imageBlob: Blob, filename?: string): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Unauthenticated');

  const name = filename || `${Date.now()}_${Math.random().toString(36).substring(2, 9)}.jpg`;
  const storageRef = ref(storage, `artworks/${artworkId}/layers/${name}`);
  const snapshot = await uploadBytes(storageRef, imageBlob, {
    contentType: imageBlob.type || 'image/jpeg',
    customMetadata: {
      ownerId: user.uid,
      artworkId,
    },
  });

  return getDownloadURL(snapshot.ref);
}

/**
 * Creates a new milestone layer in Firestore atomically updating artwork's updatedAt timestamp
 */
export async function createLayer(
  artworkId: string,
  imageUrl: string,
  notes?: string,
  techniques: string[] = [],
  colorPaletteSuggestions: string[] = [],
  customCreatedAt?: string,
  order?: number
): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Unauthenticated');

  const batch = writeBatch(db);
  const layerDocRef = doc(collection(db, `artworks/${artworkId}/layers`));
  const now = new Date().toISOString();

  const layerData: Record<string, any> = {
    artworkId,
    imageUrl,
    ownerId: user.uid,
    techniques,
    colorPaletteSuggestions,
    createdAt: customCreatedAt || now,
  };

  if (notes) layerData.notes = notes;
  if (order !== undefined) layerData.order = order;

  batch.set(layerDocRef, layerData);

  // Update parent artwork's timestamp in the same atomic transaction
  const artworkRef = doc(db, 'artworks', artworkId);
  batch.update(artworkRef, { updatedAt: now });

  await batch.commit();
  return layerDocRef.id;
}

export async function updateLayersOrder(artworkId: string, layersWithNewOrder: { id: string; order: number }[]): Promise<void> {
  const batch = writeBatch(db);
  layersWithNewOrder.forEach((item) => {
    const layerRef = doc(db, `artworks/${artworkId}/layers`, item.id);
    batch.update(layerRef, { order: item.order });
  });
  await batch.commit();
}

/**
 * Deletes a layer document from Firestore and removes the corresponding image from Firebase Storage
 */
export async function deleteLayer(artworkId: string, layerId: string, imageUrl?: string): Promise<void> {
  const layerRef = doc(db, `artworks/${artworkId}/layers`, layerId);
  await deleteDoc(layerRef);

  if (imageUrl && imageUrl.includes('firebasestorage.googleapis.com')) {
    try {
      const storageRef = ref(storage, imageUrl);
      await deleteObject(storageRef);
    } catch (storageErr) {
      console.warn('Could not delete storage object (may have already been deleted):', storageErr);
    }
  }
}

/**
 * Completely deletes an artwork, all its milestone layers, and all its stored assets atomically
 */
export async function deleteArtworkComplete(artworkId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Unauthenticated');

  // Fetch all layers
  const layersSnap = await getDocs(collection(db, `artworks/${artworkId}/layers`));
  const layers = layersSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));

  // Atomic batch delete for all Firestore documents
  const batch = writeBatch(db);
  for (const layer of layers) {
    batch.delete(doc(db, `artworks/${artworkId}/layers`, layer.id));
  }
  batch.delete(doc(db, 'artworks', artworkId));

  await batch.commit();

  // Delete all storage assets
  for (const layer of layers) {
    if (layer.imageUrl && layer.imageUrl.includes('firebasestorage.googleapis.com')) {
      try {
        const storageRef = ref(storage, layer.imageUrl);
        await deleteObject(storageRef);
      } catch (err) {
        console.warn('Storage file cleanup note:', err);
      }
    }
  }
}

// ==========================================
// Authenticated Server Vision API
// ==========================================

export async function detectCanvasBoundsApi(
  fileOrBlob: File | Blob,
  method: 'opencv' | 'gemini'
): Promise<{ bounds: CanvasBounds; mode: string }> {
  const token = await getAuthToken();
  const formData = new FormData();
  formData.append('file', fileOrBlob);
  formData.append('method', method);

  const res = await fetch('/api/detect-canvas-bounds', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Failed to detect canvas bounds');
  }

  return { bounds: data.bounds, mode: data.mode };
}

export async function perspectiveWarpApi(fileOrBlob: File | Blob, points: PerspectivePoint[]): Promise<Blob> {
  const token = await getAuthToken();
  const formData = new FormData();
  formData.append('file', fileOrBlob);
  formData.append('points', JSON.stringify(points));

  const res = await fetch('/api/perspective-warp', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.error || 'Perspective warp failed');
  }

  return res.blob();
}

export async function alignMilestonesApi(targetFileOrBlob: File | Blob, baseFileOrBlob: File | Blob): Promise<Blob> {
  const token = await getAuthToken();
  const formData = new FormData();
  formData.append('target', targetFileOrBlob);
  formData.append('base', baseFileOrBlob);

  const res = await fetch('/api/align', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.error || 'Milestone alignment failed');
  }

  return res.blob();
}
