import React, { useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { format } from 'date-fns';
import { Play, Download, Loader2, Crop } from 'lucide-react';
import { Artwork, Layer, WebGPUFilterOptions } from '../../types';
import { getWebGpuRenderer } from '../../lib/webgpuRenderer';

interface ArtworkCanvasProps {
  artwork: Artwork;
  layers: Layer[];
  currentDisplayIndex: number;
  prevDisplayIndex: number;
  currentDisplayLayer: Layer | undefined;
  isPlaying: boolean;
  playbackIndex: number | null;
  transitionEffect: 'fade' | 'cut';
  frameDelay: number;
  enableWebGPU: boolean;
  webGpuOptions: WebGPUFilterOptions;
  generating: boolean;
  onTogglePlay: () => void;
  onExportTimelapse: () => void;
  onRecalculateAlignment: (layer: Layer) => void;
  onWebGpuError: (message: string) => void;
}

export const ArtworkCanvas: React.FC<ArtworkCanvasProps> = ({
  artwork,
  layers,
  currentDisplayIndex,
  prevDisplayIndex,
  currentDisplayLayer,
  isPlaying,
  playbackIndex,
  transitionEffect,
  frameDelay,
  enableWebGPU,
  webGpuOptions,
  generating,
  onTogglePlay,
  onExportTimelapse,
  onRecalculateAlignment,
  onWebGpuError,
}) => {
  const webGpuCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!enableWebGPU || !webGpuCanvasRef.current || !currentDisplayLayer?.imageUrl) return;

    let active = true;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = currentDisplayLayer.imageUrl;

    image.onload = async () => {
      if (!active || !webGpuCanvasRef.current) return;
      try {
        await getWebGpuRenderer().render(webGpuCanvasRef.current, image, webGpuOptions);
      } catch (error) {
        if (!active) return;
        console.error('WebGPU render error:', error);
        onWebGpuError(error instanceof Error ? error.message : String(error));
      }
    };
    image.onerror = () => {
      if (active) onWebGpuError('The active milestone could not be loaded by the WebGPU renderer.');
    };

    return () => {
      active = false;
    };
  }, [enableWebGPU, currentDisplayLayer?.imageUrl, webGpuOptions, onWebGpuError]);

  const currentLayerNumber = currentDisplayIndex >= 0 ? currentDisplayIndex + 1 : layers.length;

  return (
    <div className="relative w-full max-w-4xl h-full md:min-h-[60vh] md:max-h-[85vh] shadow-2xl rounded-sm overflow-hidden bg-white flex flex-col justify-center items-center">
      {!isPlaying && currentDisplayLayer && (
        <div className="absolute top-3 left-3 sm:top-6 sm:left-6 z-20 flex gap-2">
          <button
            type="button"
            onClick={() => onRecalculateAlignment(currentDisplayLayer)}
            className="bg-white/95 hover:bg-brand-surface border border-brand-accent/20 hover:border-brand-accent transition-all px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-full text-[9px] sm:text-[10px] font-black uppercase tracking-widest shadow-md text-brand-accent flex items-center gap-1 sm:gap-1.5"
          >
            <Crop className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-brand-accent" />
            <span>Recalculate Alignment</span>
          </button>
        </div>
      )}

      <div className="absolute inset-0 w-full h-full overflow-hidden bg-white flex items-center justify-center">
        {enableWebGPU ? (
          <canvas ref={webGpuCanvasRef} className="block max-w-full max-h-full" aria-label="Filtered artwork preview" />
        ) : layers.length > 0 ? (
          <div className="absolute inset-0 w-full h-full flex items-center justify-center">
            {layers.map((layer, index) => {
              const isCurrent = index === currentDisplayIndex;
              const isPrevious = index === prevDisplayIndex;
              if (!isCurrent && !isPrevious) return null;

              return (
                <motion.img
                  key={layer.id}
                  src={layer.imageUrl}
                  alt={`Milestone ${index + 1}`}
                  initial={isCurrent && transitionEffect === 'fade' ? { opacity: 0 } : { opacity: 1 }}
                  animate={{ opacity: isCurrent ? 1 : 0 }}
                  style={{ zIndex: isCurrent ? 10 : 0 }}
                  transition={
                    transitionEffect === 'fade'
                      ? { duration: Math.min((frameDelay / 1000) * 0.75, 0.45), ease: 'linear' }
                      : { duration: 0 }
                  }
                  className="absolute inset-0 w-full h-full object-contain"
                  crossOrigin="anonymous"
                />
              );
            })}
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-brand-muted bg-white text-sm font-medium">
            No Milestones Yet
          </div>
        )}
      </div>

      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />

      <div className="absolute bottom-4 left-4 sm:bottom-8 sm:left-8 text-white z-10 drop-shadow-xl p-2.5 sm:p-4 rounded-lg bg-black/30 backdrop-blur-sm max-w-[85%] sm:max-w-[70%]">
        <span className="text-[9px] sm:text-[10px] uppercase tracking-widest opacity-90 mb-0.5 sm:mb-1 block font-bold text-white/90">
          {isPlaying ? 'Timelapse Preview Active' : 'Selected Progress Milestone'}
        </span>
        <h2 className="text-xl sm:text-4xl font-serif italic text-white leading-tight">{artwork.title}</h2>
      </div>

      <div className="absolute top-3 right-3 sm:top-6 sm:right-6 flex flex-col gap-1 sm:gap-2 z-10">
        <div className="bg-white/95 backdrop-blur px-3 sm:px-4 py-1 sm:py-1.5 rounded-full text-[9px] sm:text-[10px] font-bold uppercase tracking-tighter shadow-sm border border-black/5 text-brand-text flex items-center gap-1.5 sm:gap-2">
          {isPlaying && playbackIndex !== null
            ? `Timelapse: ${playbackIndex + 1}/${layers.length}`
            : `Layer ${currentLayerNumber}`}
          <span className={`w-1.5 h-1.5 rounded-full inline-block ${isPlaying ? 'bg-brand-accent animate-ping' : 'bg-brand-accent'}`} />
        </div>
        <div className="bg-white/90 backdrop-blur px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-full text-[9px] sm:text-[10px] font-bold uppercase tracking-tighter shadow-sm border border-black/5 text-brand-muted self-end">
          {currentDisplayLayer
            ? format(new Date(currentDisplayLayer.createdAt), 'MMM d, h:mm a')
            : format(new Date(artwork.createdAt), 'MMM d, yyyy')}
        </div>
      </div>

      <div className="absolute bottom-4 right-4 sm:bottom-8 sm:right-8 flex gap-2 sm:gap-3 z-10">
        {layers.length >= 2 && (
          <button
            type="button"
            onClick={onTogglePlay}
            className={`px-3 sm:px-5 py-2 sm:py-2.5 text-[9px] sm:text-[10px] uppercase tracking-widest font-bold rounded-full shadow-xl transition-all flex items-center gap-1.5 sm:gap-2 border ${
              isPlaying
                ? 'bg-brand-accent text-white border-brand-accent hover:scale-105'
                : 'bg-white text-brand-text border-black/10 hover:bg-brand-surface hover:scale-105'
            }`}
          >
            {isPlaying ? (
              <span className="w-1.5 h-1.5 bg-white rounded-full animate-ping mr-1" />
            ) : (
              <Play className="w-2.5 sm:w-3 h-2.5 sm:h-3 fill-current" />
            )}
            {isPlaying ? 'Pause' : 'Play'}
          </button>
        )}
        <button
          type="button"
          onClick={onExportTimelapse}
          disabled={layers.length < 2 || generating}
          className="px-3 sm:px-5 py-2 sm:py-2.5 bg-brand-text text-white text-[9px] sm:text-[10px] uppercase tracking-widest font-bold rounded-full shadow-xl hover:bg-black hover:scale-105 transition-all disabled:opacity-50 disabled:hover:scale-100 flex items-center gap-1.5 sm:gap-2 border border-white/20 disabled:cursor-not-allowed"
        >
          {generating ? <Loader2 className="w-3.5 sm:w-4 h-3.5 sm:h-4 animate-spin" /> : <Download className="w-3.5 sm:w-4 h-3.5 sm:h-4" />}
          <span className="hidden sm:inline">
            {layers.length < 2 ? 'Upload 2+ layers to Export' : 'Export Video'}
          </span>
          <span className="inline sm:hidden">Export</span>
        </button>
      </div>
    </div>
  );
};
