import { alignMilestonesApi, perspectiveWarpApi } from './api';
import { PerspectivePoint } from '../types';

/**
 * High-precision computer vision alignment between two milestone images using ORB & Homography
 */
export async function autoAlignImage(params: {
  baseFileOrBlob: File | Blob;
  targetFileOrBlob: File | Blob;
}): Promise<Blob> {
  return alignMilestonesApi(params.targetFileOrBlob, params.baseFileOrBlob);
}

/**
 * Homographic perspective warp to de-slant an image from 4 corner points
 */
export async function warpPerspectiveImage(
  fileOrBlob: File | Blob,
  points: PerspectivePoint[]
): Promise<Blob> {
  return perspectiveWarpApi(fileOrBlob, points);
}
