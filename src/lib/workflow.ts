import { CanvasBounds } from '../types';

export interface ClassicCropGeometry {
  crop: { x: number; y: number };
  zoom: number;
  aspectRatio: number;
  croppedAreaPixels: { x: number; y: number; width: number; height: number };
}

export interface TimelapseTiming {
  frameDelayMs: number;
  holdMs: number;
  transitionDurationMs: number;
  transitionFrames: number;
  transitionStepMs: number;
}

export function canvasBoundsToCrop(
  _bounds: CanvasBounds,
  _naturalWidth: number,
  _naturalHeight: number,
): ClassicCropGeometry {
  throw new Error('Not implemented');
}

export function createTimelapseTiming(
  _frameDelayMs: number,
  _transitionEffect: 'fade' | 'cut',
  _framesPerSecond: number,
): TimelapseTiming {
  throw new Error('Not implemented');
}

export function createStorageObjectPath(
  _userId: string,
  _artworkId: string,
  _filename: string,
): string {
  throw new Error('Not implemented');
}
