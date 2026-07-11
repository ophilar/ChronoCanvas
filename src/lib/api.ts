import { collection, doc, query, where, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Artwork, Layer } from '../types';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  if (errInfo.error.includes('unavailable') || errInfo.error.includes('offline')) {
    console.warn('Ignoring unavailable/offline firestore error so app does not crash');
    return;
  }
  throw new Error(JSON.stringify(errInfo));
}

// Artworks
export function subscribeToArtworks(userId: string, callback: (artworks: Artwork[]) => void) {
  const q = query(collection(db, 'artworks'), where('ownerId', '==', userId));
  return onSnapshot(q, (snapshot) => {
    const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Artwork))
      .sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    callback(list);
  }, (error) => {
    handleFirestoreError(error, OperationType.GET, 'artworks');
  });
}

export async function createArtwork(title: string, description?: string) {
  const user = auth.currentUser;
  if (!user) throw new Error("Unauthenticated");
  const docRef = doc(collection(db, 'artworks'));
  const now = new Date().toISOString();
  const data = {
    title,
    ownerId: user.uid,
    status: 'in_progress',
    createdAt: now,
    updatedAt: now,
  };
  if (description) {
    (data as any).description = description;
  }
  try {
    await setDoc(docRef, data);
  } catch(error) {
    handleFirestoreError(error, OperationType.CREATE, 'artworks');
  }
  return docRef.id;
}

// Layers
export function subscribeToLayers(artworkId: string, userId: string, callback: (layers: Layer[]) => void) {
  const q = query(collection(db, `artworks/${artworkId}/layers`), where('ownerId', '==', userId));
  return onSnapshot(q, (snapshot) => {
    const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Layer))
      .sort((a, b) => {
        const orderA = a.order !== undefined ? a.order : Number.MAX_SAFE_INTEGER;
        const orderB = b.order !== undefined ? b.order : Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
    callback(list);
  }, (error) => {
    handleFirestoreError(error, OperationType.LIST, `artworks/${artworkId}/layers`);
  });
}

export async function createLayer(
  artworkId: string, 
  imageUrl: string, 
  notes: string | undefined, 
  techniques: string[], 
  colorPaletteSuggestions: string[],
  customCreatedAt?: string,
  order?: number
) {
  const user = auth.currentUser;
  if(!user) throw new Error("Unauthenticated");
  const docRef = doc(collection(db, `artworks/${artworkId}/layers`));
  const data = {
    artworkId,
    imageUrl,
    ownerId: user.uid,
    techniques,
    colorPaletteSuggestions,
    createdAt: customCreatedAt || new Date().toISOString()
  };
  if(notes) (data as any).notes = notes;
  if(order !== undefined) (data as any).order = order;
  
  try {
    await setDoc(docRef, data);
    await updateDoc(doc(db, 'artworks', artworkId), { updatedAt: new Date().toISOString() });
  } catch(error) {
    handleFirestoreError(error, OperationType.CREATE, `artworks/${artworkId}/layers`);
  }
  return docRef.id;
}

export async function updateLayerOrder(artworkId: string, layerId: string, order: number) {
  try {
    const layerRef = doc(db, `artworks/${artworkId}/layers`, layerId);
    await updateDoc(layerRef, { order });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `artworks/${artworkId}/layers/${layerId}`);
  }
}

export async function updateLayersOrder(artworkId: string, layersWithNewOrder: { id: string; order: number }[]) {
  try {
    const batch = writeBatch(db);
    layersWithNewOrder.forEach((item) => {
      const layerRef = doc(db, `artworks/${artworkId}/layers`, item.id);
      batch.update(layerRef, { order: item.order });
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `artworks/${artworkId}/layers`);
  }
}

export async function deleteLayer(artworkId: string, layerId: string, imageUrl?: string) {
  try {
    const layerRef = doc(db, `artworks/${artworkId}/layers`, layerId);
    await deleteDoc(layerRef);
    if (imageUrl) {
      await fetch("/api/cleanup-files", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ urls: [imageUrl] })
      }).catch(err => console.error("Failed to requests server cleanup-files:", err));
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `artworks/${artworkId}/layers/${layerId}`);
  }
}



export async function deleteArtworkComplete(artworkId: string) {
  const user = auth.currentUser;
  if (!user) throw new Error("Unauthenticated");

  try {
    // 1. Fetch layers to get file URLs
    const layersSnap = await getDocs(collection(db, `artworks/${artworkId}/layers`));
    const layers = layersSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

    // 2. Fetch photos to get file URLs
    const photosSnap = await getDocs(collection(db, `artworks/${artworkId}/photos`));
    const photos = photosSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

    const urlsToDelete: string[] = [];
    layers.forEach((layer: any) => {
      if (layer.imageUrl) urlsToDelete.push(layer.imageUrl);
    });
    photos.forEach((photo: any) => {
      if (photo.imageUrl) urlsToDelete.push(photo.imageUrl);
    });

    // 3. Delete layers from subcollection
    for (const layer of layers) {
      await deleteDoc(doc(db, `artworks/${artworkId}/layers`, layer.id));
    }

    // 4. Delete photos from subcollection
    for (const photo of photos) {
      await deleteDoc(doc(db, `artworks/${artworkId}/photos`, photo.id));
    }

    // 5. Delete parent artwork doc
    await deleteDoc(doc(db, 'artworks', artworkId));

    // 6. Request the backend server to clean up physical storage files
    if (urlsToDelete.length > 0) {
      await fetch("/api/cleanup-files", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ urls: urlsToDelete })
      }).catch(err => console.error("Failed to requests server cleanup-files:", err));
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `artworks/${artworkId}`);
  }
}


