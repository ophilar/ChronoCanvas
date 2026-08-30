import { WebGPUFilterOptions } from '../types';
import { getWebGpuRenderer } from './webgpuRenderer';

export type { WebGPUFilterOptions as GPUFilterOptions };

export async function renderImageWithWebGPU(
  canvas: HTMLCanvasElement,
  imageElement: HTMLImageElement,
  options: WebGPUFilterOptions
): Promise<void> {
  const renderer = getWebGpuRenderer();
  await renderer.render(canvas, imageElement, options);
}
