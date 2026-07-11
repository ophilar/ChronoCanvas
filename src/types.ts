export interface Artwork {
  id: string;
  title: string;
  description?: string;
  status: 'in_progress' | 'completed' | 'archived';
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Layer {
  id: string;
  artworkId: string;
  imageUrl: string;
  notes?: string;
  techniques: string[];
  colorPaletteSuggestions: string[];
  ownerId: string;
  createdAt: string;
  order?: number;
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';
  path: string | null;
  authInfo: any;
}
