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
  techniques?: string[];
  colorPaletteSuggestions?: string[];
  ownerId: string;
  createdAt: string;
  order?: number;
}

export interface PerspectivePoint {
  x: number;
  y: number;
}

export interface CanvasBounds {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
  centerX?: number;
  centerY?: number;
  width?: number;
  height?: number;
}

export interface WebGPUFilterOptions {
  brightness: number;  // Multiplier: 0.5 to 2.0
  contrast: number;    // Coefficient: 0.5 to 2.0
  saturation: number;  // Coefficient: 0.0 to 2.0
}
