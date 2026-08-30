import React, { useState } from 'react';
import { format } from 'date-fns';
import { useDropzone } from 'react-dropzone';
import { ImagePlus, Loader2, ArrowLeft, Crop, Trash2 } from 'lucide-react';
import type { Layer } from '../../types';

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
  });

  return (
    <section className="flex-1 overflow-hidden flex flex-col" aria-labelledby="progress-history-title">
      <div className="flex items-center justify-between gap-3 border-b border-brand-border px-4 sm:px-6 py-4 bg-brand-surface/30">
        <div>
          <h2 id="progress-history-title" className="text-xs uppercase tracking-[0.2em] font-bold text-brand-text">Progress History</h2>
          <p className="text-[10px] text-brand-muted mt-0.5">
            {layers.length} milestone{layers.length !== 1 ? 's' : ''} recorded
          </p>
        </div>

        {confirmDeleteArtwork ? (
          <div className="flex items-center gap-1.5" role="group" aria-label="Confirm artwork deletion">
            <button
              type="button"
              onClick={onDeleteArtwork}
              className="px-2.5 py-1 bg-red-600 text-white text-[9px] uppercase tracking-widest font-bold rounded hover:bg-red-700 transition-all shadow-sm"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirmDeleteArtwork(false)}
              className="px-2 py-1 bg-gray-100 text-brand-text text-[9px] uppercase tracking-widest font-bold rounded hover:bg-gray-200 transition-colors border border-black/5"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDeleteArtwork(true)}
            className="px-3 py-1 text-[10px] text-red-600 border border-red-200 rounded-full hover:bg-red-50 flex items-center gap-1.5 transition-colors font-semibold uppercase tracking-wider"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </button>
        )}
      </div>

      <div className="flex-1 p-4 sm:p-6 space-y-4 overflow-y-visible md:overflow-y-auto">
        <p className="text-[10px] text-brand-muted leading-relaxed p-3 bg-brand-surface rounded-lg border border-brand-border/40">
          <strong>Frame alignment:</strong> keep the camera steady and include consistent artwork borders for smoother timelapse transitions.
        </p>

        <div
          {...getRootProps({
            'aria-label': 'Add one or more progress milestone images',
          })}
          className={`sticky top-0 bg-brand-surface border-2 border-dashed rounded-xl p-6 text-center transition-all duration-300 mb-6 z-10 flex flex-col items-center justify-center gap-3
            ${isDragActive ? 'border-brand-accent bg-white/80' : 'border-brand-border hover:border-brand-accent/50'}
            ${uploading ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
        >
          <input {...getInputProps()} />
          <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-brand-accent shadow-sm" aria-hidden="true">
            {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImagePlus className="w-5 h-5" />}
          </div>
          <div className="text-[10px] uppercase tracking-widest font-bold text-brand-text">
            Add progress milestones
          </div>
          <div className="text-[9px] text-brand-muted">Multiple files are processed in chronological order.</div>
        </div>

        <div className="space-y-3" role="list" aria-label="Artwork milestones">
          {layers.map((layer, index) => {
            const isCurrentlyDisplayed = playbackIndex !== null
              ? playbackIndex === index
              : selectedLayerId !== null
                ? selectedLayerId === layer.id
                : index === layers.length - 1;

            return (
              <article
                key={layer.id}
                role="listitem"
                className={`relative rounded-xl transition-all border ${
                  isCurrentlyDisplayed
                    ? 'bg-brand-surface border-brand-accent shadow-sm'
                    : 'bg-white border-brand-border hover:border-brand-accent/30 hover:bg-brand-surface/20'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectLayer(layer.id)}
                  aria-current={isCurrentlyDisplayed ? 'true' : undefined}
                  className="w-full flex gap-3 items-center p-3 pr-32 text-left rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-inset"
                >
                  <span className="w-12 h-12 bg-brand-surface rounded-lg overflow-hidden flex-shrink-0 border border-brand-border relative">
                    <img
                      src={layer.imageUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      crossOrigin="anonymous"
                    />
                    <span className="absolute top-0.5 left-0.5 bg-black/75 text-white font-mono text-[8px] px-1 rounded uppercase tracking-tighter">
                      L{index + 1}
                    </span>
                  </span>

                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[10px] font-extrabold uppercase text-brand-text truncate">
                        {index === 0 ? '1. Baseline' : `${index + 1}. Milestone`}
                      </span>
                      {isCurrentlyDisplayed && <span className="w-1.5 h-1.5 rounded-full bg-brand-accent" aria-hidden="true" />}
                    </span>
                    <span className="block text-[9px] text-brand-muted font-bold font-mono mt-0.5 tracking-wider">
                      {format(new Date(layer.createdAt), 'MMM d, h:mm a')}
                    </span>
                  </span>
                </button>

                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center bg-white/95 backdrop-blur rounded-full p-0.5 shadow-sm border border-brand-border z-20" role="group" aria-label={`Actions for milestone ${index + 1}`}>
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => onMoveLayer(index, 'up')}
                    className={`p-1 rounded-full ${index === 0 ? 'text-gray-300 cursor-not-allowed opacity-30' : 'text-brand-text hover:bg-brand-surface hover:text-brand-accent'}`}
                    aria-label={`Move milestone ${index + 1} earlier`}
                  >
                    <ArrowLeft className="w-3.5 h-3.5 rotate-90" />
                  </button>
                  <button
                    type="button"
                    disabled={index === layers.length - 1}
                    onClick={() => onMoveLayer(index, 'down')}
                    className={`p-1 rounded-full ${index === layers.length - 1 ? 'text-gray-300 cursor-not-allowed opacity-30' : 'text-brand-text hover:bg-brand-surface hover:text-brand-accent'}`}
                    aria-label={`Move milestone ${index + 1} later`}
                  >
                    <ArrowLeft className="w-3.5 h-3.5 -rotate-90" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRecalculateAlignment(layer)}
                    className="p-1 rounded-full text-brand-text hover:bg-brand-surface hover:text-brand-accent"
                    aria-label={`Reframe milestone ${index + 1}`}
                  >
                    <Crop className="w-3.5 h-3.5 text-brand-accent" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingLayerId(layer.id)}
                    className="p-1 rounded-full text-red-500 hover:bg-red-50 hover:text-red-700 transition"
                    aria-label={`Delete milestone ${index + 1}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {deletingLayerId === layer.id && (
                  <div className="absolute inset-0 bg-white z-30 flex items-center justify-between gap-3 px-4 rounded-xl border border-red-200">
                    <span className="text-[10px] font-black uppercase tracking-wider text-red-600">Delete milestone?</span>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          onDeleteLayer(layer.id, layer.imageUrl);
                          setDeletingLayerId(null);
                        }}
                        className="px-2.5 py-1 bg-red-600 text-white text-[9px] uppercase tracking-widest font-black rounded hover:bg-red-700 transition"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingLayerId(null)}
                        className="px-2.5 py-1 bg-white border border-brand-border text-brand-text text-[9px] uppercase tracking-widest font-bold rounded hover:bg-brand-surface transition"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>

        {layers.length === 0 && (
          <div className="text-center py-8 text-brand-muted text-[10px] uppercase tracking-wider font-bold">
            No milestones recorded
          </div>
        )}
      </div>
    </section>
  );
};
