import React, { useState, useRef, useEffect, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import { Sparkles, Scan, RotateCw, Check, X, Loader2, Wand2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { getCroppedImg } from '../../lib/cropImage';
import { detectCanvasBoundsApi, perspectiveWarpApi, alignMilestonesApi } from '../../lib/api';
import { PerspectivePoint, CanvasBounds } from '../../types';

interface CropModalProps {
  isOpen: boolean;
  imageSrc: string | null;
  baseLayerImageUrl?: string;
  onClose: () => void;
  onSave: (croppedBlob: Blob) => Promise<void>;
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
  const [aspectRatio, setAspectRatio] = useState<number | undefined>(undefined);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [alignWithBase, setAlignWithBase] = useState(false);

  // 4 perspective corner points (normalized 0.0 to 1.0)
  const [warpPoints, setWarpPoints] = useState<PerspectivePoint[]>([
    { x: 0.05, y: 0.05 }, // Top-Left
    { x: 0.95, y: 0.05 }, // Top-Right
    { x: 0.95, y: 0.95 }, // Bottom-Right
    { x: 0.05, y: 0.95 }, // Bottom-Left
  ]);

  const [activeDragPoint, setActiveDragPoint] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // Reset state when opening modal
  useEffect(() => {
    if (isOpen) {
      setMode('classic');
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setRotation(0);
      setWarpPoints([
        { x: 0.05, y: 0.05 },
        { x: 0.95, y: 0.05 },
        { x: 0.95, y: 0.95 },
        { x: 0.05, y: 0.95 },
      ]);
      setAlignWithBase(Boolean(baseLayerImageUrl));
    }
  }, [isOpen, baseLayerImageUrl]);

  const onCropComplete = useCallback((_croppedArea: any, pixels: any) => {
    setCroppedAreaPixels(pixels);
  }, []);

  // Fetch current image as blob
  const getImageBlob = async (): Promise<Blob> => {
    if (!imageSrc) throw new Error('No image loaded');
    const res = await fetch(imageSrc);
    return res.blob();
  };

  // Auto-Detect Canvas Bounds using OpenCV or Gemini AI
  const handleAutoDetectBounds = async (method: 'opencv' | 'gemini') => {
    if (!imageSrc) return;
    setDetecting(true);
    const toastId = toast.loading(
      method === 'gemini' ? 'Analyzing artwork canvas with Gemini AI...' : 'Scanning canvas edges with Computer Vision...'
    );

    try {
      const blob = await getImageBlob();
      const result = await detectCanvasBoundsApi(blob, method);
      const bounds: CanvasBounds = result.bounds;

      if (mode === 'classic') {
        // Set classic crop view centered on detected bounds
        if (imageRef.current || containerRef.current) {
          toast.success(
            `Canvas detected (${result.mode.toUpperCase()})!`,
            { id: toastId }
          );
        }
      } else {
        // Set the 4 warp points to detected corners
        setWarpPoints([
          { x: Math.max(0, bounds.xmin), y: Math.max(0, bounds.ymin) },
          { x: Math.min(1, bounds.xmax), y: Math.max(0, bounds.ymin) },
          { x: Math.min(1, bounds.xmax), y: Math.min(1, bounds.ymax) },
          { x: Math.max(0, bounds.xmin), y: Math.min(1, bounds.ymax) },
        ]);
        toast.success(`Quadrilateral bounds detected (${result.mode.toUpperCase()})!`, { id: toastId });
      }
    } catch (err: any) {
      console.error('Bounds detection failed:', err);
      toast.error(err.message || 'Detection failed', { id: toastId });
    } finally {
      setDetecting(false);
    }
  };

  // Drag handlers for 4 perspective quad points
  const handlePointerDown = (index: number, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveDragPoint(index);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (activeDragPoint === null || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    setWarpPoints((prev) => {
      const copy = [...prev];
      copy[activeDragPoint] = { x, y };
      return copy;
    });
  };

  const handlePointerUp = () => {
    setActiveDragPoint(null);
  };

  // Save / Process cropped or warped image
  const handleSave = async () => {
    if (!imageSrc) return;
    setIsProcessing(true);
    const toastId = toast.loading('Processing image...');

    try {
      let finalBlob: Blob;

      if (mode === 'classic') {
        if (!croppedAreaPixels) {
          throw new Error('Crop region is not ready');
        }
        finalBlob = await getCroppedImg(imageSrc, croppedAreaPixels, rotation);
      } else {
        const rawBlob = await getImageBlob();
        toast.loading('Applying perspective de-slant warp...', { id: toastId });
        finalBlob = await perspectiveWarpApi(rawBlob, warpPoints);
      }

      // If user enabled auto-alignment with the baseline milestone
      if (alignWithBase && baseLayerImageUrl) {
        toast.loading('Aligning keypoints against baseline milestone...', { id: toastId });
        const baseRes = await fetch(baseLayerImageUrl);
        const baseBlob = await baseRes.blob();
        try {
          finalBlob = await alignMilestonesApi(finalBlob, baseBlob);
          toast.success('Successfully aligned with baseline milestone!', { id: toastId });
        } catch (alignErr: any) {
          console.warn('Alignment warning:', alignErr);
          toast.error(alignErr.message || 'Milestone alignment failed, saving crop without warp.', {
            id: toastId,
          });
        }
      }

      toast.loading('Saving milestone...', { id: toastId });
      await onSave(finalBlob);
      toast.success('Milestone updated successfully!', { id: toastId });
      onClose();
    } catch (err: any) {
      console.error('Save error:', err);
      toast.error(err.message || 'Failed to process image', { id: toastId });
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen || !imageSrc) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in">
      <div className="bg-[#FAF9F6] w-full max-w-4xl max-h-[95vh] rounded-2xl shadow-2xl border border-brand-border flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-border bg-white">
          <div className="flex items-center gap-3">
            <h3 className="font-serif italic font-bold text-lg text-brand-text">
              Framing & Alignment Studio
            </h3>
            <div className="flex bg-brand-surface p-0.5 rounded-lg border border-brand-border text-[10px] font-bold uppercase tracking-wider">
              <button
                onClick={() => setMode('classic')}
                className={`px-3 py-1 rounded-md transition cursor-pointer ${
                  mode === 'classic' ? 'bg-white shadow-sm text-brand-text' : 'text-brand-muted hover:text-brand-text'
                }`}
              >
                Rectangular Crop
              </button>
              <button
                onClick={() => setMode('warp')}
                className={`px-3 py-1 rounded-md transition cursor-pointer ${
                  mode === 'warp' ? 'bg-white shadow-sm text-brand-text' : 'text-brand-muted hover:text-brand-text'
                }`}
              >
                Perspective Quad
              </button>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-brand-surface text-brand-muted hover:text-brand-text transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Workspace Canvas Area */}
        <div
          className="relative flex-1 bg-black/90 min-h-[380px] max-h-[60vh] flex items-center justify-center overflow-hidden select-none"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {mode === 'classic' ? (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              aspect={aspectRatio}
              onCropChange={setCrop}
              onCropComplete={onCropComplete}
              onZoomChange={setZoom}
            />
          ) : (
            <div
              ref={containerRef}
              className="relative max-w-full max-h-full aspect-auto flex items-center justify-center p-4"
            >
              <img
                ref={imageRef}
                src={imageSrc}
                alt="Source preview"
                className="max-w-full max-h-[50vh] object-contain block pointer-events-none rounded shadow"
                crossOrigin="anonymous"
              />

              {/* Interactive 4-point perspective quad overlay */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none">
                <polygon
                  points={warpPoints.map((p) => `${p.x * 100}%,${p.y * 100}%`).join(' ')}
                  fill="rgba(197, 160, 89, 0.2)"
                  stroke="#C5A059"
                  strokeWidth="2"
                  strokeDasharray="4 4"
                />
              </svg>

              {warpPoints.map((p, idx) => (
                <div
                  key={idx}
                  onPointerDown={(e) => handlePointerDown(idx, e)}
                  style={{
                    left: `${p.x * 100}%`,
                    top: `${p.y * 100}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                  className={`absolute w-7 h-7 rounded-full bg-brand-accent text-white border-2 border-white shadow-lg flex items-center justify-center text-[10px] font-black cursor-grab active:cursor-grabbing z-20 transition-transform ${
                    activeDragPoint === idx ? 'scale-125 ring-4 ring-brand-accent/40' : 'hover:scale-110'
                  }`}
                >
                  {idx + 1}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Toolbar & Controls Footer */}
        <div className="p-5 bg-white border-t border-brand-border space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Aspect Ratio & Transform Buttons */}
            {mode === 'classic' ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider font-bold text-brand-muted">
                  Aspect:
                </span>
                {[
                  { label: 'Free', val: undefined },
                  { label: '1:1', val: 1 },
                  { label: '4:3', val: 4 / 3 },
                  { label: '16:9', val: 16 / 9 },
                  { label: '3:4', val: 3 / 4 },
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={() => setAspectRatio(item.val)}
                    className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider border transition cursor-pointer ${
                      aspectRatio === item.val
                        ? 'bg-brand-text text-white border-brand-text'
                        : 'bg-white text-brand-text border-brand-border hover:border-brand-accent'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}

                <button
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  className="p-1.5 rounded-lg border border-brand-border hover:bg-brand-surface text-brand-text transition cursor-pointer ml-2"
                  title="Rotate 90°"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="text-[10px] text-brand-muted font-medium">
                💡 Drag corners 1-4 to match the corners of your canvas board.
              </div>
            )}

            {/* Smart Detection Buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleAutoDetectBounds('opencv')}
                disabled={detecting}
                className="px-3 py-1.5 bg-brand-surface border border-brand-border hover:border-brand-accent text-brand-text text-[10px] uppercase tracking-wider font-bold rounded-lg flex items-center gap-1.5 transition cursor-pointer shadow-sm disabled:opacity-50"
              >
                {detecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scan className="w-3.5 h-3.5 text-brand-accent" />}
                <span>CV Auto-Detect</span>
              </button>

              <button
                onClick={() => handleAutoDetectBounds('gemini')}
                disabled={detecting}
                className="px-3 py-1.5 bg-gradient-to-r from-amber-50 to-amber-100/60 border border-amber-200 hover:border-brand-accent text-brand-text text-[10px] uppercase tracking-wider font-bold rounded-lg flex items-center gap-1.5 transition cursor-pointer shadow-sm disabled:opacity-50"
              >
                {detecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-brand-accent" />}
                <span>Gemini AI Canvas</span>
              </button>
            </div>
          </div>

          {/* Baseline alignment option & Final Actions */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-brand-border/60">
            {baseLayerImageUrl ? (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={alignWithBase}
                  onChange={(e) => setAlignWithBase(e.target.checked)}
                  className="w-4 h-4 accent-brand-accent rounded cursor-pointer"
                />
                <span className="text-[10px] uppercase tracking-wider font-bold text-brand-text flex items-center gap-1">
                  <Wand2 className="w-3 h-3 text-brand-accent" />
                  Auto-Align brushwork with Baseline milestone
                </span>
              </label>
            ) : (
              <div className="text-[10px] text-brand-muted italic">
                Baseline milestone (Layer 1)
              </div>
            )}

            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={onClose}
                disabled={isProcessing}
                className="px-4 py-2 bg-white border border-brand-border text-brand-text text-[10px] uppercase tracking-widest font-bold rounded-full hover:bg-brand-surface transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isProcessing}
                className="px-6 py-2 bg-brand-text text-white text-[10px] uppercase tracking-widest font-bold rounded-full hover:bg-black transition flex items-center gap-1.5 shadow-md disabled:opacity-50 cursor-pointer"
              >
                {isProcessing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                <span>Apply & Save</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
