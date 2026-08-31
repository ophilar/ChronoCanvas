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
  imageUrl: string;
  notes?: string;
  techniques?: string[];
  colorPaletteSuggestions?: string[];
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
  brightness: number;
  contrast: number;
  saturation: number;
}
