import type { CanvasBounds } from '../types';

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

export type MilestoneMoveDirection = 'up' | 'down';

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
}

function assertNormalizedBounds(bounds: CanvasBounds): void {
  const values = [bounds.ymin, bounds.xmin, bounds.ymax, bounds.xmax];
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error('Invalid canvas bounds: coordinates must be finite values between 0 and 1');
  }
  if (bounds.xmax <= bounds.xmin || bounds.ymax <= bounds.ymin) {
    throw new Error('Invalid canvas bounds: maximum coordinates must exceed minimum coordinates');
  }
}

export function canvasBoundsToCrop(
  bounds: CanvasBounds,
  naturalWidth: number,
  naturalHeight: number,
): ClassicCropGeometry {
  assertPositiveFinite(naturalWidth, 'naturalWidth');
  assertPositiveFinite(naturalHeight, 'naturalHeight');
  assertNormalizedBounds(bounds);

  const left = Math.round(bounds.xmin * naturalWidth);
  const top = Math.round(bounds.ymin * naturalHeight);
  const right = Math.round(bounds.xmax * naturalWidth);
  const bottom = Math.round(bounds.ymax * naturalHeight);
  const width = right - left;
  const height = bottom - top;

  if (width <= 0 || height <= 0) {
    throw new Error('Invalid canvas bounds: detected crop has no pixel area');
  }

  const normalizedWidth = bounds.xmax - bounds.xmin;
  const normalizedHeight = bounds.ymax - bounds.ymin;
  const centerX = (bounds.xmin + bounds.xmax) / 2;
  const centerY = (bounds.ymin + bounds.ymax) / 2;
  const zoom = 1 / Math.max(normalizedWidth, normalizedHeight);

  return {
    crop: {
      x: (0.5 - centerX) * 100 * zoom,
      y: (0.5 - centerY) * 100 * zoom,
    },
    zoom,
    aspectRatio: width / height,
    croppedAreaPixels: { x: left, y: top, width, height },
  };
}

export function getMilestoneMoveTarget(
  index: number,
  direction: MilestoneMoveDirection,
  milestoneCount: number,
): number | null {
  if (index === 0) return null;

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex <= 0 || targetIndex >= milestoneCount) return null;
  return targetIndex;
}

export function createTimelapseTiming(
  frameDelayMs: number,
  transitionEffect: 'fade' | 'cut',
  framesPerSecond: number,
): TimelapseTiming {
  assertPositiveFinite(frameDelayMs, 'frameDelayMs');
  assertPositiveFinite(framesPerSecond, 'framesPerSecond');

  if (transitionEffect === 'cut') {
    return {
      frameDelayMs,
      holdMs: frameDelayMs,
      transitionDurationMs: 0,
      transitionFrames: 0,
      transitionStepMs: 0,
    };
  }

  const transitionDurationMs = frameDelayMs * 0.75;
  const holdMs = frameDelayMs - transitionDurationMs;
  const transitionFrames = Math.max(1, Math.floor((transitionDurationMs * framesPerSecond) / 1000));

  return {
    frameDelayMs,
    holdMs,
    transitionDurationMs,
    transitionFrames,
    transitionStepMs: transitionDurationMs / transitionFrames,
  };
}

function assertPathSegment(value: string): void {
  if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\')) {
    throw new Error(`Invalid storage path segment: ${value}`);
  }
}

export function createStorageObjectPath(
  userId: string,
  artworkId: string,
  filename: string,
): string {
  assertPathSegment(userId);
  assertPathSegment(artworkId);
  assertPathSegment(filename);
  return `users/${userId}/artworks/${artworkId}/layers/${filename}`;
}
