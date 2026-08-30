import React, { useState, useRef, useEffect, useCallback } from 'react';
import Cropper, { Area } from 'react-easy-crop';
import { Sparkles, Scan, RotateCw, Check, X, Loader2, Wand2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { getCroppedImg } from '../../lib/cropImage';
import { detectCanvasBoundsApi, perspectiveWarpApi, alignMilestonesApi } from '../../lib/api';
import { canvasBoundsToCrop } from '../../lib/workflow';
import type { PerspectivePoint } from '../../types';

interface CropModalProps {
  isOpen: boolean;
  imageSrc: string | null;
  baseLayerImageUrl?: string;
  onClose: () => void;
  onSave: (croppedBlob: Blob) => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const CropModal: React.FC<CropModalProps> = ({
  isOpen,
  imageSrc,
  baseLayerImageUrl,
  onClose,
  onSave,
}) => {
  const [mode, setMode] = useState<'classic' | 'warp'>('classic');
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [aspectRatio, setAspectRatio] = useState<number | undefined>();
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [initialCroppedAreaPixels, setInitialCroppedAreaPixels] = useState<Area | undefined>();
  const [cropperRevision, setCropperRevision] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [alignWithBase, setAlignWithBase] = useState(false);
  const [warpPoints, setWarpPoints] = useState<PerspectivePoint[]>([
    { x: 0.05, y: 0.05 },
    { x: 0.95, y: 0.05 },
    { x: 0.95, y: 0.95 },
    { x: 0.05, y: 0.95 },
  ]);
  const [activeDragPoint, setActiveDragPoint] = useState<number | null>(null);
  const imageFrameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setMode('classic');
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
    setAspectRatio(undefined);
    setCroppedAreaPixels(null);
    setInitialCroppedAreaPixels(undefined);
    setWarpPoints([
      { x: 0.05, y: 0.05 },
      { x: 0.95, y: 0.05 },
      { x: 0.95, y: 0.95 },
      { x: 0.05, y: 0.95 },
    ]);
    setAlignWithBase(Boolean(baseLayerImageUrl));
  }, [isOpen, imageSrc, baseLayerImageUrl]);

  const onCropComplete = useCallback((_croppedArea: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const getImageBlob = async (source = imageSrc): Promise<Blob> => {
    if (!source) throw new Error('No image loaded');
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Failed to load image (${response.status})`);
    return response.blob();
  };

  const handleAutoDetectBounds = async (method: 'opencv' | 'gemini') => {
    if (!imageSrc) return;
    setDetecting(true);
    const toastId = toast.loading(
      method === 'gemini' ? 'Analyzing artwork canvas with Gemini AI...' : 'Scanning canvas edges with Computer Vision...',
    );

    try {
      const blob = await getImageBlob();
      const [result, bitmap] = await Promise.all([
        detectCanvasBoundsApi(blob, method),
        createImageBitmap(blob),
      ]);
      const geometry = canvasBoundsToCrop(result.bounds, bitmap.width, bitmap.height);
      bitmap.close();

      if (mode === 'classic') {
        setRotation(0);
        setCrop(geometry.crop);
        setZoom(geometry.zoom);
        setAspectRatio(geometry.aspectRatio);
        setCroppedAreaPixels(geometry.croppedAreaPixels);
        setInitialCroppedAreaPixels(geometry.croppedAreaPixels);
        setCropperRevision((revision) => revision + 1);
        toast.success(`Canvas crop applied (${result.mode.toUpperCase()}).`, { id: toastId });
      } else {
        const { xmin, ymin, xmax, ymax } = result.bounds;
        setWarpPoints([
          { x: xmin, y: ymin },
          { x: xmax, y: ymin },
          { x: xmax, y: ymax },
          { x: xmin, y: ymax },
        ]);
        toast.success(`Perspective bounds applied (${result.mode.toUpperCase()}).`, { id: toastId });
      }
    } catch (error) {
      console.error('Bounds detection failed:', error);
      toast.error(errorMessage(error), { id: toastId });
    } finally {
      setDetecting(false);
    }
  };

  const updateWarpPoint = useCallback((index: number, point: PerspectivePoint) => {
    setWarpPoints((previous) => {
      const updated = [...previous];
      updated[index] = point;
      return updated;
    });
  }, []);

  const handlePointerDown = (index: number, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveDragPoint(index);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (activeDragPoint === null || !imageFrameRef.current) return;
    const rect = imageFrameRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    updateWarpPoint(activeDragPoint, { x, y });
  };

  const handlePointKeyDown = (index: number, event: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 0.02 : 0.005;
    const direction = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    }[event.key];
    if (!direction) return;
    event.preventDefault();
    const point = warpPoints[index];
    updateWarpPoint(index, {
      x: Math.max(0, Math.min(1, point.x + direction.x)),
      y: Math.max(0, Math.min(1, point.y + direction.y)),
    });
  };

  const handleSave = async () => {
    if (!imageSrc) return;
    setIsProcessing(true);
    const toastId = toast.loading('Processing image...');

    try {
      let finalBlob: Blob;
      if (mode === 'classic') {
        if (!croppedAreaPixels) throw new Error('Crop region is not ready');
        finalBlob = await getCroppedImg(imageSrc, croppedAreaPixels, rotation);
      } else {
        const rawBlob = await getImageBlob();
        toast.loading('Applying perspective de-slant warp...', { id: toastId });
        finalBlob = await perspectiveWarpApi(rawBlob, warpPoints);
      }

      if (alignWithBase && baseLayerImageUrl) {
        toast.loading('Aligning keypoints against baseline milestone...', { id: toastId });
        const baseBlob = await getImageBlob(baseLayerImageUrl);
        finalBlob = await alignMilestonesApi(finalBlob, baseBlob);
      }

      toast.loading('Saving milestone...', { id: toastId });
      await onSave(finalBlob);
      toast.success('Milestone saved.', { id: toastId });
    } catch (error) {
      console.error('Save error:', error);
      toast.error(errorMessage(error), { id: toastId });
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen || !imageSrc) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="crop-dialog-title"
    >
      <div className="bg-[#FAF9F6] w-full max-w-4xl max-h-[95vh] rounded-2xl shadow-2xl border border-brand-border flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-4 px-4 sm:px-6 py-4 border-b border-brand-border bg-white">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 min-w-0">
            <h3 id="crop-dialog-title" className="font-serif italic font-bold text-lg text-brand-text">
              Framing & Alignment Studio
            </h3>
            <div className="flex bg-brand-surface p-0.5 rounded-lg border border-brand-border text-[10px] font-bold uppercase tracking-wider">
              <button
                type="button"
                aria-pressed={mode === 'classic'}
                onClick={() => setMode('classic')}
                disabled={isProcessing}
                className={`px-3 py-1 rounded-md transition cursor-pointer ${
                  mode === 'classic' ? 'bg-white shadow-sm text-brand-text' : 'text-brand-muted hover:text-brand-text'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                Rectangular Crop
              </button>
              <button
                type="button"
                aria-pressed={mode === 'warp'}
                onClick={() => setMode('warp')}
                disabled={isProcessing}
                className={`px-3 py-1 rounded-md transition cursor-pointer ${
                  mode === 'warp' ? 'bg-white shadow-sm text-brand-text' : 'text-brand-muted hover:text-brand-text'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                Perspective Quad
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            aria-label="Close framing studio"
            className="p-1.5 rounded-full hover:bg-brand-surface text-brand-muted hover:text-brand-text transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div
          className="relative flex-1 bg-black/90 min-h-[320px] sm:min-h-[380px] max-h-[60vh] flex items-center justify-center overflow-hidden select-none"
          onPointerMove={handlePointerMove}
          onPointerUp={() => setActiveDragPoint(null)}
          onPointerCancel={() => setActiveDragPoint(null)}
        >
          {mode === 'classic' ? (
            <Cropper
              key={cropperRevision}
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              aspect={aspectRatio}
              initialCroppedAreaPixels={initialCroppedAreaPixels}
              onCropChange={setCrop}
              onCropComplete={onCropComplete}
              onZoomChange={setZoom}
            />
          ) : (
            <div ref={imageFrameRef} className="relative inline-block max-w-full max-h-[50vh]">
              <img
                src={imageSrc}
                alt="Source artwork for perspective correction"
                className="max-w-full max-h-[50vh] object-contain block rounded shadow"
                crossOrigin="anonymous"
                draggable={false}
              />

              <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
                <polygon
                  points={warpPoints.map((point) => `${point.x * 100}%,${point.y * 100}%`).join(' ')}
                  fill="rgba(197, 160, 89, 0.2)"
                  stroke="#C5A059"
                  strokeWidth="2"
                  strokeDasharray="4 4"
                />
              </svg>

              {warpPoints.map((point, index) => (
                <button
                  type="button"
                  key={index}
                  aria-label={`Perspective corner ${index + 1}`}
                  onPointerDown={(event) => handlePointerDown(index, event)}
                  onKeyDown={(event) => handlePointKeyDown(index, event)}
                  style={{
                    left: `${point.x * 100}%`,
                    top: `${point.y * 100}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                  className={`absolute w-8 h-8 rounded-full bg-brand-accent text-white border-2 border-white shadow-lg flex items-center justify-center text-[10px] font-black cursor-grab active:cursor-grabbing z-20 transition-transform ${
                    activeDragPoint === index ? 'scale-125 ring-4 ring-brand-accent/40' : 'hover:scale-110 focus:scale-110'
                  }`}
                >
                  {index + 1}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-5 bg-white border-t border-brand-border space-y-4 overflow-y-auto">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {mode === 'classic' ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider font-bold text-brand-muted">Aspect:</span>
                {[
                  { label: 'Free', value: undefined },
                  { label: '1:1', value: 1 },
                  { label: '4:3', value: 4 / 3 },
                  { label: '16:9', value: 16 / 9 },
                  { label: '3:4', value: 3 / 4 },
                ].map((item) => (
                  <button
                    type="button"
                    key={item.label}
                    aria-pressed={aspectRatio === item.value}
                    onClick={() => setAspectRatio(item.value)}
                    disabled={isProcessing}
                    className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider border transition cursor-pointer ${
                      aspectRatio === item.value
                        ? 'bg-brand-text text-white border-brand-text'
                        : 'bg-white text-brand-text border-brand-border hover:border-brand-accent'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {item.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setRotation((value) => (value + 90) % 360)}
                  disabled={isProcessing}
                  className="p-1.5 rounded-lg border border-brand-border hover:bg-brand-surface text-brand-text transition cursor-pointer ml-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Rotate image 90 degrees"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="text-[10px] text-brand-muted font-medium">
                💡 Drag corners 1–4 to match the corners of your canvas board; use arrow keys for fine adjustment.
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleAutoDetectBounds('opencv')}
                disabled={detecting || isProcessing}
                className="px-3 py-1.5 bg-brand-surface border border-brand-border hover:border-brand-accent text-brand-text text-[10px] uppercase tracking-wider font-bold rounded-lg flex items-center gap-1.5 transition cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {detecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scan className="w-3.5 h-3.5 text-brand-accent" />}
                <span>CV Auto-Detect</span>
              </button>

              <button
                type="button"
                onClick={() => void handleAutoDetectBounds('gemini')}
                disabled={detecting || isProcessing}
                className="px-3 py-1.5 bg-gradient-to-r from-amber-50 to-amber-100/60 border border-amber-200 hover:border-brand-accent text-brand-text text-[10px] uppercase tracking-wider font-bold rounded-lg flex items-center gap-1.5 transition cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {detecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-brand-accent" />}
                <span>Gemini AI Canvas</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-brand-border/60">
            {baseLayerImageUrl ? (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={alignWithBase}
                  onChange={(event) => setAlignWithBase(event.target.checked)}
                  disabled={isProcessing}
                  className="w-4 h-4 accent-brand-accent rounded cursor-pointer disabled:cursor-not-allowed"
                />
                <span className="text-[10px] uppercase tracking-wider font-bold text-brand-text flex items-center gap-1">
                  <Wand2 className="w-3 h-3 text-brand-accent" />
                  Auto-Align brushwork with Baseline milestone
                </span>
              </label>
            ) : (
              <div className="text-[10px] text-brand-muted italic">Baseline milestone (Layer 1)</div>
            )}

            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={onClose}
                disabled={isProcessing}
                className="px-4 py-2 bg-white border border-brand-border text-brand-text text-[10px] uppercase tracking-widest font-bold rounded-full hover:bg-brand-surface transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={isProcessing || detecting}
                className="px-6 py-2 bg-brand-text text-white text-[10px] uppercase tracking-widest font-bold rounded-full hover:bg-black transition flex items-center gap-1.5 shadow-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                <span>Apply & Save</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};