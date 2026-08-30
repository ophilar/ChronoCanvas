import React from 'react';
import { Play, Pause, SkipBack, SkipForward, Download, Loader2, Sparkles, Cpu } from 'lucide-react';
import { Layer, WebGPUFilterOptions } from '../../types';

interface TimelapseStudioProps {
  layers: Layer[];
  isPlaying: boolean;
  playbackIndex: number | null;
  selectedLayerId: string | null;
  frameDelay: number;
  transitionEffect: 'fade' | 'cut';
  loopPlayback: boolean;
  enableWebGPU: boolean;
  webGpuOptions: WebGPUFilterOptions;
  generating: boolean;
  onTogglePlay: () => void;
  onStepFrame: (direction: -1 | 1) => void;
  onSetFrameDelay: (delay: number) => void;
  onSetTransitionEffect: (effect: 'fade' | 'cut') => void;
  onSetLoopPlayback: (loop: boolean) => void;
  onSetEnableWebGPU: (enabled: boolean) => void;
  onSetWebGpuOptions: React.Dispatch<React.SetStateAction<WebGPUFilterOptions>>;
  onExportTimelapse: () => void;
}

export const TimelapseStudio: React.FC<TimelapseStudioProps> = ({
  layers,
  isPlaying,
  playbackIndex,
  selectedLayerId,
  frameDelay,
  transitionEffect,
  loopPlayback,
  enableWebGPU,
  webGpuOptions,
  generating,
  onTogglePlay,
  onStepFrame,
  onSetFrameDelay,
  onSetTransitionEffect,
  onSetLoopPlayback,
  onSetEnableWebGPU,
  onSetWebGpuOptions,
  onExportTimelapse,
}) => {
  const currentActiveIndex =
    playbackIndex !== null
      ? playbackIndex
      : selectedLayerId !== null
      ? layers.findIndex((l) => l.id === selectedLayerId)
      : layers.length - 1;

  return (
    <div className="flex-1 overflow-y-visible md:overflow-y-auto p-6 space-y-6">
      {/* Playback Controls Card */}
      <div className="bg-brand-surface p-5 rounded-2xl border border-brand-border space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-brand-muted">
            Timelapse Engine
          </span>
          <span className="text-[9px] font-mono font-bold text-brand-accent bg-brand-accent/10 px-2 py-0.5 rounded">
            {layers.length} Frames
          </span>
        </div>

        {/* Playback Buttons */}
        <div className="flex items-center justify-center gap-3 py-2">
          <button
            onClick={() => onStepFrame(-1)}
            disabled={layers.length < 2}
            className="p-2.5 rounded-full bg-white border border-brand-border text-brand-text hover:bg-brand-surface disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer shadow-sm"
            title="Previous Frame"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          <button
            onClick={onTogglePlay}
            disabled={layers.length < 2}
            className="px-6 py-3 rounded-full bg-brand-accent text-white font-bold text-xs uppercase tracking-widest hover:scale-105 transition-all flex items-center gap-2 shadow-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isPlaying ? (
              <>
                <Pause className="w-4 h-4 fill-current" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>Play Loop</span>
              </>
            )}
          </button>

          <button
            onClick={() => onStepFrame(1)}
            disabled={layers.length < 2}
            className="p-2.5 rounded-full bg-white border border-brand-border text-brand-text hover:bg-brand-surface disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer shadow-sm"
            title="Next Frame"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>

        {/* Scrubber Progress Bar */}
        {layers.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <div className="flex justify-between text-[9px] font-mono font-bold text-brand-muted uppercase">
              <span>Frame {Math.max(0, currentActiveIndex) + 1}</span>
              <span>Total {layers.length}</span>
            </div>
            <div className="h-2 bg-brand-border/60 rounded-full overflow-hidden flex gap-0.5">
              {layers.map((_, i) => (
                <div
                  key={i}
                  className={`flex-1 transition-colors ${
                    i === currentActiveIndex ? 'bg-brand-accent' : i < currentActiveIndex ? 'bg-brand-text/70' : 'bg-transparent'
                  }`}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Speed & Delay Presets */}
      <div className="space-y-2">
        <label className="text-[10px] uppercase tracking-widest font-bold text-brand-text block">
          Frame Interval ({frameDelay / 1000}s)
        </label>
        <div className="grid grid-cols-4 gap-1.5">
          {[200, 500, 1000, 1500].map((d) => (
            <button
              key={d}
              onClick={() => onSetFrameDelay(d)}
              className={`py-2 text-[10px] font-mono font-bold rounded-lg border transition cursor-pointer ${
                frameDelay === d
                  ? 'bg-brand-text text-white border-brand-text shadow-sm'
                  : 'bg-white text-brand-muted border-brand-border hover:border-brand-accent/40'
              }`}
            >
              {d / 1000}s
            </button>
          ))}
        </div>
      </div>

      {/* Transition Style & Loop Options */}
      <div className="space-y-3 pt-2">
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-widest font-bold text-brand-text block">
            Transition Style
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onSetTransitionEffect('fade')}
              className={`py-2 px-3 text-[10px] font-bold uppercase tracking-wider rounded-lg border transition cursor-pointer ${
                transitionEffect === 'fade'
                  ? 'bg-brand-text text-white border-brand-text'
                  : 'bg-white text-brand-muted border-brand-border hover:border-brand-accent/40'
              }`}
            >
              Smooth Fade
            </button>
            <button
              onClick={() => onSetTransitionEffect('cut')}
              className={`py-2 px-3 text-[10px] font-bold uppercase tracking-wider rounded-lg border transition cursor-pointer ${
                transitionEffect === 'cut'
                  ? 'bg-brand-text text-white border-brand-text'
                  : 'bg-white text-brand-muted border-brand-border hover:border-brand-accent/40'
              }`}
            >
              Instant Cut
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between p-3 bg-brand-surface rounded-xl border border-brand-border">
          <span className="text-[10px] uppercase tracking-wider font-bold text-brand-text">
            Continuous Loop
          </span>
          <input
            type="checkbox"
            checked={loopPlayback}
            onChange={(e) => onSetLoopPlayback(e.target.checked)}
            className="w-4 h-4 accent-brand-accent rounded cursor-pointer"
          />
        </div>
      </div>

      {/* WebGPU Hardware Acceleration Panel */}
      <div className="p-4 bg-brand-surface rounded-xl border border-brand-border space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-brand-accent" />
            <span className="text-[10px] uppercase tracking-wider font-extrabold text-brand-text">
              WebGPU Engine
            </span>
          </div>
          <input
            type="checkbox"
            checked={enableWebGPU}
            onChange={(e) => onSetEnableWebGPU(e.target.checked)}
            className="w-4 h-4 accent-brand-accent rounded cursor-pointer"
          />
        </div>

        {enableWebGPU && (
          <div className="space-y-2.5 pt-2 border-t border-brand-border/60">
            <div>
              <div className="flex justify-between text-[9px] font-mono font-bold text-brand-muted mb-1">
                <span>Brightness</span>
                <span>{webGpuOptions.brightness.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.05"
                value={webGpuOptions.brightness}
                onChange={(e) =>
                  onSetWebGpuOptions((prev) => ({ ...prev, brightness: parseFloat(e.target.value) }))
                }
                className="w-full h-1.5 bg-brand-border rounded-lg accent-brand-accent cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-[9px] font-mono font-bold text-brand-muted mb-1">
                <span>Contrast</span>
                <span>{webGpuOptions.contrast.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.05"
                value={webGpuOptions.contrast}
                onChange={(e) =>
                  onSetWebGpuOptions((prev) => ({ ...prev, contrast: parseFloat(e.target.value) }))
                }
                className="w-full h-1.5 bg-brand-border rounded-lg accent-brand-accent cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-[9px] font-mono font-bold text-brand-muted mb-1">
                <span>Saturation</span>
                <span>{webGpuOptions.saturation.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min="0.0"
                max="2.0"
                step="0.05"
                value={webGpuOptions.saturation}
                onChange={(e) =>
                  onSetWebGpuOptions((prev) => ({ ...prev, saturation: parseFloat(e.target.value) }))
                }
                className="w-full h-1.5 bg-brand-border rounded-lg accent-brand-accent cursor-pointer"
              />
            </div>

            <button
              onClick={() => onSetWebGpuOptions({ brightness: 1.0, contrast: 1.0, saturation: 1.0 })}
              className="w-full py-1 text-[9px] uppercase tracking-widest font-bold text-brand-muted hover:text-brand-text transition cursor-pointer"
            >
              Reset Shaders
            </button>
          </div>
        )}
      </div>

      {/* Export Action Card */}
      <div className="p-4 bg-brand-surface rounded-xl border border-brand-border space-y-3">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-brand-accent" />
          <span className="text-[10px] uppercase tracking-wider font-extrabold text-brand-text">
            Export Studio Video
          </span>
        </div>
        <p className="text-[10px] text-brand-muted leading-relaxed">
          Renders a smooth 1080p WebM video file compiled directly from your progression milestones.
        </p>
        <button
          onClick={onExportTimelapse}
          disabled={layers.length < 2 || generating}
          className="w-full py-3 bg-brand-text text-white text-[10px] uppercase tracking-widest font-bold rounded-xl hover:bg-black transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          <span>{generating ? 'Compiling Video Frames...' : 'Download Timelapse (WebM)'}</span>
        </button>
      </div>
    </div>
  );
};
