import React, { useState } from 'react';
import { format } from 'date-fns';
import { useDropzone } from 'react-dropzone';
import { ImagePlus, Loader2, ArrowLeft, Crop, Trash2 } from 'lucide-react';
import { Layer } from '../../types';

interface MilestonesListProps {
  layers: Layer[];
  selectedLayerId: string | null;
  playbackIndex: number | null;
  uploading: boolean;
  onDropFiles: (files: File[]) => void;
  onSelectLayer: (layerId: string) => void;
  onMoveLayer: (index: number, direction: 'up' | 'down') => void;
  onDeleteLayer: (layerId: string, imageUrl: string) => void;
  onRecalculateAlignment: (layer: Layer) => void;
  onDeleteArtwork: () => void;
}

export const MilestonesList: React.FC<MilestonesListProps> = ({
  layers,
  selectedLayerId,
  playbackIndex,
  uploading,
  onDropFiles,
  onSelectLayer,
  onMoveLayer,
  onDeleteLayer,
  onRecalculateAlignment,
  onDeleteArtwork,
}) => {
  const [confirmDeleteArtwork, setConfirmDeleteArtwork] = useState(false);
  const [deletingLayerId, setDeletingLayerId] = useState<string | null>(null);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDropFiles,
    accept: {
      'image/jpeg': ['.jpeg', '.jpg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
      'image/gif': ['.gif'],
      'image/heic': ['.heic'],
      'image/heif': ['.heif'],
    },
    multiple: true,
    disabled: uploading,
  } as any);

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="flex items-center justify-between border-b border-brand-border px-6 py-4 bg-brand-surface/30">
        <div>
          <h3 className="text-xs uppercase tracking-[0.2em] font-bold text-brand-text">Progress History</h3>
          <p className="text-[10px] text-brand-muted mt-0.5">
            {layers.length} milestone{layers.length !== 1 ? 's' : ''} recorded
          </p>
        </div>

        {confirmDeleteArtwork ? (
          <div className="flex items-center gap-1.5 z-10">
            <button
              onClick={onDeleteArtwork}
              className="px-2.5 py-1 bg-red-600 text-white text-[9px] uppercase tracking-widest font-bold rounded hover:bg-red-700 transition-all shadow-sm cursor-pointer"
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirmDeleteArtwork(false)}
              className="px-2 py-1 bg-gray-150 text-brand-text text-[9px] uppercase tracking-widest font-bold rounded hover:bg-gray-200 transition-colors border border-black/5 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDeleteArtwork(true)}
            className="p-1 px-3 text-[10px] text-red-600 border border-red-200 rounded-full hover:bg-red-50 flex items-center gap-1.5 transition-colors font-semibold uppercase tracking-wider cursor-pointer"
            title="Delete project"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </button>
        )}
      </div>

      <div className="flex-1 p-6 space-y-4 overflow-y-visible md:overflow-y-auto">
        <p className="text-[10px] text-brand-muted leading-relaxed mb-4 p-3 bg-brand-surface rounded-lg border border-brand-border/40 italic">
          ✨ <strong>Paint Frame Alignment:</strong> Keep camera steady and capture milestones with consistent borders for smooth timelapse transitions.
        </p>

        {/* Dropzone */}
        <div
          {...getRootProps()}
          className={`sticky top-0 bg-brand-surface border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-300 mb-6 z-10 flex flex-col items-center justify-center gap-3
          ${isDragActive ? 'border-brand-accent bg-white/80' : 'border-brand-border hover:border-brand-accent/50'} 
          ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <input {...getInputProps()} />
          <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-brand-accent shadow-sm">
            {uploading ? (
              <Loader2 className="w-5 h-5 animate-spin text-brand-accent" />
            ) : (
              <ImagePlus className="w-5 h-5 text-brand-accent" />
            )}
          </div>
          <div className="text-[10px] uppercase tracking-widest font-bold text-brand-text">
            Drop new progress milestone
          </div>
        </div>

        {/* Layer list */}
        {layers.map((layer, index) => {
          const isCurrentlyDisplayed =
            playbackIndex !== null
              ? playbackIndex === index
              : selectedLayerId !== null
              ? selectedLayerId === layer.id
              : index === layers.length - 1;

          return (
            <div
              key={layer.id}
              onClick={() => onSelectLayer(layer.id)}
              className={`group relative flex gap-3 items-center p-3 rounded-xl cursor-pointer transition-all border ${
                isCurrentlyDisplayed
                  ? 'bg-brand-surface border-brand-accent shadow-sm'
                  : 'bg-white border-brand-border hover:border-brand-accent/30 hover:bg-brand-surface/20'
              }`}
            >
              {/* Thumbnail */}
              <div className="w-12 h-12 bg-brand-surface rounded-lg overflow-hidden flex-shrink-0 border border-brand-border relative">
                <img
                  src={layer.imageUrl}
                  alt={`Layer ${index + 1}`}
                  className="w-full h-full object-cover"
                  crossOrigin="anonymous"
                />
                <div className="absolute top-0.5 left-0.5 bg-black/75 text-white font-mono text-[8px] px-1 rounded uppercase tracking-tighter">
                  L{index + 1}
                </div>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0 pr-16">
                <div className="flex items-center gap-1.5">
                  <p className="text-[10px] font-extrabold uppercase text-brand-text truncate">
                    {index === 0 ? '1. Baseline' : `${index + 1}. Milestone`}
                  </p>
                  {isCurrentlyDisplayed && <span className="w-1.5 h-1.5 rounded-full bg-brand-accent" />}
                </div>
                <p className="text-[9px] text-brand-muted font-bold font-mono mt-0.5 tracking-wider">
                  {format(new Date(layer.createdAt), 'MMM d, h:mm a')}
                </p>
              </div>

              {/* Action buttons */}
              <div className="absolute right-2 flex items-center bg-white/95 backdrop-blur rounded-full p-0.5 shadow-sm border border-brand-border transition-all duration-150 z-20">
                <button
                  disabled={index === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onMoveLayer(index, 'up');
                  }}
                  className={`p-1 rounded-full ${
                    index === 0
                      ? 'text-gray-300 cursor-not-allowed opacity-30'
                      : 'text-brand-text hover:bg-brand-surface hover:text-brand-accent cursor-pointer'
                  }`}
                  title="Move Up Timeline"
                >
                  <ArrowLeft className="w-3.5 h-3.5 rotate-90" />
                </button>

                <button
                  disabled={index === layers.length - 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onMoveLayer(index, 'down');
                  }}
                  className={`p-1 rounded-full ${
                    index === layers.length - 1
                      ? 'text-gray-300 cursor-not-allowed opacity-30'
                      : 'text-brand-text hover:bg-brand-surface hover:text-brand-accent cursor-pointer'
                  }`}
                  title="Move Down Timeline"
                >
                  <ArrowLeft className="w-3.5 h-3.5 -rotate-90" />
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRecalculateAlignment(layer);
                  }}
                  className="p-1 rounded-full text-brand-text hover:bg-brand-surface hover:text-brand-accent cursor-pointer"
                  title="Recalculate Alignment & Crop"
                >
                  <Crop className="w-3.5 h-3.5 text-brand-accent" />
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeletingLayerId(layer.id);
                  }}
                  className="p-1 rounded-full text-red-500 hover:bg-red-50 hover:text-red-700 transition cursor-pointer"
                  title="Delete Layer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Confirm layer delete overlay */}
              {deletingLayerId === layer.id && (
                <div className="absolute inset-0 bg-white/98 z-30 flex items-center justify-between px-4 rounded-xl border border-red-200">
                  <span className="text-[10px] font-black uppercase tracking-wider text-red-600">
                    Delete milestone?
                  </span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteLayer(layer.id, layer.imageUrl);
                        setDeletingLayerId(null);
                      }}
                      className="px-2.5 py-1 bg-red-600 text-white text-[9px] uppercase tracking-widest font-black rounded hover:bg-red-700 transition cursor-pointer"
                    >
                      Delete
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingLayerId(null);
                      }}
                      className="px-2.5 py-1 bg-white border border-brand-border text-brand-text text-[9px] uppercase tracking-widest font-bold rounded hover:bg-brand-surface transition cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {layers.length === 0 && (
          <div className="text-center py-8 text-brand-muted text-[10px] uppercase tracking-wider font-bold">
            No layering history available
          </div>
        )}
      </div>
    </div>
  );
};
