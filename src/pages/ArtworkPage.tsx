import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import {
  subscribeToLayers,
  createLayer,
  updateLayersOrder,
  deleteLayer,
  deleteArtworkComplete,
  uploadImageToStorage,
} from '../lib/api';
import { Artwork, Layer, WebGPUFilterOptions } from '../types';
import { ArtworkCanvas } from '../components/artwork/ArtworkCanvas';
import { MilestonesList } from '../components/artwork/MilestonesList';
import { TimelapseStudio } from '../components/artwork/TimelapseStudio';
import { CropModal } from '../components/artwork/CropModal';
import { Loader2, History, Video } from 'lucide-react';
import toast from 'react-hot-toast';
import heic2any from 'heic2any';

export default function ArtworkPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [artwork, setArtwork] = useState<Artwork | null>(null);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);

  // Studio tabs: milestones history vs timelapse engine
  const [activeTab, setActiveTab] = useState<'milestones' | 'timelapse'>('milestones');

  // Playback & Animation states
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState<number | null>(null);
  const [prevPlaybackIndex, setPrevPlaybackIndex] = useState<number | null>(null);
  const [frameDelay, setFrameDelay] = useState(500); // ms per frame
  const [transitionEffect, setTransitionEffect] = useState<'fade' | 'cut'>('fade');
  const [loopPlayback, setLoopPlayback] = useState(true);

  // WebGPU Hardware acceleration
  const [enableWebGPU, setEnableWebGPU] = useState(false);
  const [webGpuOptions, setWebGpuOptions] = useState<WebGPUFilterOptions>({
    brightness: 1.0,
    contrast: 1.0,
    saturation: 1.0,
  });

  // Video Export state
  const [generatingVideo, setGeneratingVideo] = useState(false);

  // Upload & Cropping state
  const [uploading, setUploading] = useState(false);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [currentCroppingImageSrc, setCurrentCroppingImageSrc] = useState<string | null>(null);
  const [recalculatingLayer, setRecalculatingLayer] = useState<Layer | null>(null);

  // Fetch parent artwork doc
  useEffect(() => {
    if (!id || !user) return;
    const fetchArtwork = async () => {
      try {
        const docRef = doc(db, 'artworks', id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setArtwork({ id: docSnap.id, ...docSnap.data() } as Artwork);
        } else {
          toast.error('Artwork project not found');
          navigate('/dashboard');
        }
      } catch (err: any) {
        console.error('Fetch artwork error:', err);
        toast.error(err.message || 'Failed to load artwork');
      } finally {
        setLoading(false);
      }
    };
    fetchArtwork();
  }, [id, user, navigate]);

  // Subscribe to layers subcollection
  useEffect(() => {
    if (!id || !user) return;
    const unsubscribe = subscribeToLayers(id, user.uid, (data) => {
      setLayers(data);
      // Default to latest layer if none selected
      if (data.length > 0 && !selectedLayerId) {
        setSelectedLayerId(data[data.length - 1].id);
      }
    });
    return () => unsubscribe();
  }, [id, user, selectedLayerId]);

  // Playback timer loop
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isPlaying && layers.length > 0) {
      timer = setInterval(() => {
        setPlaybackIndex((prev) => {
          const current = prev !== null ? prev : 0;
          setPrevPlaybackIndex(current);
          if (current >= layers.length - 1) {
            if (!loopPlayback) {
              setIsPlaying(false);
              return current;
            }
            return 0;
          }
          return current + 1;
        });
      }, frameDelay);
    }
    return () => clearInterval(timer);
  }, [isPlaying, layers.length, frameDelay, loopPlayback]);

  // Toggle play/pause
  const togglePlay = () => {
    if (layers.length < 2) {
      toast.error('Add at least 2 progress milestones to preview timelapse playback.');
      return;
    }
    if (!isPlaying) {
      setPlaybackIndex(0);
      setPrevPlaybackIndex(null);
      setIsPlaying(true);
    } else {
      setIsPlaying(false);
    }
  };

  // Step frame forward or backward
  const stepFrame = (direction: -1 | 1) => {
    setIsPlaying(false);
    const currentIndex =
      playbackIndex !== null
        ? playbackIndex
        : selectedLayerId !== null
        ? layers.findIndex((l) => l.id === selectedLayerId)
        : layers.length - 1;

    let nextIndex = currentIndex + direction;
    if (nextIndex < 0) nextIndex = layers.length - 1;
    if (nextIndex >= layers.length) nextIndex = 0;

    setPrevPlaybackIndex(currentIndex);
    setPlaybackIndex(nextIndex);
    if (layers[nextIndex]) {
      setSelectedLayerId(layers[nextIndex].id);
    }
  };

  // Process dropped files for upload & crop
  const handleDropFiles = async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    setUploading(true);

    try {
      let file = acceptedFiles[0];

      // Convert Apple HEIC/HEIF images if needed
      if (
        file.type === 'image/heic' ||
        file.type === 'image/heif' ||
        file.name.toLowerCase().endsWith('.heic') ||
        file.name.toLowerCase().endsWith('.heif')
      ) {
        const toastId = toast.loading('Converting HEIC format...');
        try {
          const convertedBlob = (await heic2any({
            blob: file,
            toType: 'image/jpeg',
            quality: 0.95,
          })) as Blob;
          file = new File([convertedBlob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), {
            type: 'image/jpeg',
          });
          toast.success('HEIC converted successfully', { id: toastId });
        } catch (err: any) {
          console.error('HEIC conversion failed:', err);
          toast.error('HEIC conversion failed', { id: toastId });
          setUploading(false);
          return;
        }
      }

      const objectUrl = URL.createObjectURL(file);
      setCurrentCroppingImageSrc(objectUrl);
      setRecalculatingLayer(null);
      setCropModalOpen(true);
    } catch (err: any) {
      console.error('Drop files error:', err);
      toast.error(err.message || 'Failed to process photo');
    } finally {
      setUploading(false);
    }
  };

  // Recalculate existing layer's alignment / crop
  const handleRecalculateAlignment = (layer: Layer) => {
    setCurrentCroppingImageSrc(layer.imageUrl);
    setRecalculatingLayer(layer);
    setCropModalOpen(true);
  };

  // Save cropped/aligned image blob to Firebase Storage and Firestore
  const handleSaveCroppedImage = async (croppedBlob: Blob) => {
    if (!id || !user) return;

    // Upload to Firebase Storage
    const imageUrl = await uploadImageToStorage(id, croppedBlob);

    if (recalculatingLayer) {
      // Create new version milestone or update
      await createLayer(
        id,
        imageUrl,
        recalculatingLayer.notes || 'Realignment adjustment',
        recalculatingLayer.techniques || [],
        recalculatingLayer.colorPaletteSuggestions || [],
        recalculatingLayer.createdAt,
        recalculatingLayer.order
      );
      // Delete old layer image
      await deleteLayer(id, recalculatingLayer.id, recalculatingLayer.imageUrl);
    } else {
      // Append as new milestone
      const newOrder = layers.length;
      const newLayerId = await createLayer(
        id,
        imageUrl,
        '',
        [],
        [],
        undefined,
        newOrder
      );
      setSelectedLayerId(newLayerId);
    }
  };

  // Reorder milestone layers
  const handleMoveLayer = async (index: number, direction: 'up' | 'down') => {
    if (!id) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= layers.length) return;

    const newLayers = [...layers];
    const [moved] = newLayers.splice(index, 1);
    newLayers.splice(targetIndex, 0, moved);

    const updates = newLayers.map((l, idx) => ({ id: l.id, order: idx }));
    try {
      await updateLayersOrder(id, updates);
      toast.success('Layer order updated');
    } catch (err: any) {
      console.error('Move layer error:', err);
      toast.error('Failed to update layer order');
    }
  };

  // Delete milestone layer
  const handleDeleteLayer = async (layerId: string, imageUrl: string) => {
    if (!id) return;
    try {
      await deleteLayer(id, layerId, imageUrl);
      toast.success('Milestone deleted');
    } catch (err: any) {
      console.error('Delete layer error:', err);
      toast.error('Failed to delete milestone');
    }
  };

  // Delete entire artwork
  const handleDeleteArtwork = async () => {
    if (!id) return;
    try {
      await deleteArtworkComplete(id);
      toast.success('Artwork deleted');
      navigate('/dashboard');
    } catch (err: any) {
      console.error('Delete artwork error:', err);
      toast.error('Failed to delete artwork');
    }
  };

  // Export full timelapse video with MediaRecorder
  const handleExportTimelapse = async () => {
    if (layers.length < 2) {
      toast.error('Upload at least 2 milestones to export a timelapse video.');
      return;
    }

    setGeneratingVideo(true);
    const toastId = toast.loading('Rendering 1080p timelapse frames...');

    try {
      // Preload all milestone images
      const loadedImages: HTMLImageElement[] = await Promise.all(
        layers.map(
          (l) =>
            new Promise<HTMLImageElement>((resolve, reject) => {
              const img = new Image();
              img.crossOrigin = 'anonymous';
              img.src = l.imageUrl;
              img.onload = () => resolve(img);
              img.onerror = () => reject(new Error(`Failed to load frame ${l.id}`));
            })
        )
      );

      const targetWidth = 1920;
      const targetHeight = 1080;

      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = targetWidth;
      exportCanvas.height = targetHeight;
      const ctx = exportCanvas.getContext('2d');
      if (!ctx) throw new Error('Could not create video export canvas');

      const stream = exportCanvas.captureStream(30);
      const recorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 6000000,
      });

      const recordedChunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
      };

      const recordPromise = new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          resolve(new Blob(recordedChunks, { type: 'video/webm' }));
        };
      });

      recorder.start();

      // Render each layer frame with crossfade
      for (let i = 0; i < loadedImages.length; i++) {
        const img = loadedImages[i];
        const nextImg = loadedImages[i + 1];

        // Draw current frame
        ctx.fillStyle = '#1A1817';
        ctx.fillRect(0, 0, targetWidth, targetHeight);

        // Aspect fit image
        const scale = Math.min(targetWidth / img.width, targetHeight / img.height);
        const x = (targetWidth - img.width * scale) / 2;
        const y = (targetHeight - img.height * scale) / 2;
        ctx.drawImage(img, x, y, img.width * scale, img.height * scale);

        // Hold frame
        await new Promise((r) => setTimeout(r, 600));

        // Crossfade to next image if available
        if (nextImg && transitionEffect === 'fade') {
          const nextScale = Math.min(targetWidth / nextImg.width, targetHeight / nextImg.height);
          const nextX = (targetWidth - nextImg.width * nextScale) / 2;
          const nextY = (targetHeight - nextImg.height * nextScale) / 2;

          const steps = 12;
          for (let step = 1; step <= steps; step++) {
            const alpha = step / steps;
            ctx.fillStyle = '#1A1817';
            ctx.fillRect(0, 0, targetWidth, targetHeight);

            ctx.globalAlpha = 1.0 - alpha;
            ctx.drawImage(img, x, y, img.width * scale, img.height * scale);

            ctx.globalAlpha = alpha;
            ctx.drawImage(nextImg, nextX, nextY, nextImg.width * nextScale, nextImg.height * nextScale);

            ctx.globalAlpha = 1.0;
            await new Promise((r) => setTimeout(r, 30));
          }
        }
      }

      // Final frame hold
      await new Promise((r) => setTimeout(r, 800));

      recorder.stop();
      const videoBlob = await recordPromise;

      // Download file
      const downloadUrl = URL.createObjectURL(videoBlob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${artwork?.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'artwork'}_timelapse.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);

      toast.success('Timelapse video generated and downloaded!', { id: toastId });
    } catch (err: any) {
      console.error('Export video error:', err);
      toast.error(err.message || 'Failed to export video', { id: toastId });
    } finally {
      setGeneratingVideo(false);
    }
  };

  if (loading || !artwork) {
    return (
      <div className="flex-1 min-h-[70vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-accent" />
      </div>
    );
  }

  // Calculate current active displayed layer
  const currentDisplayIndex =
    playbackIndex !== null
      ? playbackIndex
      : selectedLayerId !== null
      ? layers.findIndex((l) => l.id === selectedLayerId)
      : layers.length - 1;

  const currentDisplayLayer = layers[currentDisplayIndex];
  const prevDisplayIndex = prevPlaybackIndex !== null ? prevPlaybackIndex : -1;
  const baseLayer = layers[0];

  return (
    <div className="flex-1 flex flex-col md:flex-row h-auto md:h-[calc(100vh-80px)] overflow-y-auto md:overflow-hidden bg-[#FAF9F6]">
      {/* Primary Stage Canvas */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 overflow-hidden bg-brand-surface/20">
        <ArtworkCanvas
          artwork={artwork}
          layers={layers}
          currentDisplayIndex={currentDisplayIndex}
          prevDisplayIndex={prevDisplayIndex}
          currentDisplayLayer={currentDisplayLayer}
          isPlaying={isPlaying}
          playbackIndex={playbackIndex}
          transitionEffect={transitionEffect}
          frameDelay={frameDelay}
          enableWebGPU={enableWebGPU}
          webGpuOptions={webGpuOptions}
          generating={generatingVideo}
          onTogglePlay={togglePlay}
          onExportTimelapse={handleExportTimelapse}
          onRecalculateAlignment={handleRecalculateAlignment}
        />
      </div>

      {/* Control Sidebar */}
      <div className="w-full md:w-96 border-t md:border-t-0 md:border-l border-brand-border bg-white flex flex-col h-auto md:h-full shadow-lg z-20">
        {/* Navigation Tabs */}
        <div className="flex border-b border-brand-border bg-brand-surface/40 p-1">
          <button
            onClick={() => setActiveTab('milestones')}
            className={`flex-1 py-3 text-[10px] uppercase tracking-widest font-extrabold flex items-center justify-center gap-2 transition cursor-pointer ${
              activeTab === 'milestones'
                ? 'bg-white text-brand-text shadow-sm rounded-lg border border-brand-border'
                : 'text-brand-muted hover:text-brand-text'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Milestones ({layers.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('timelapse')}
            className={`flex-1 py-3 text-[10px] uppercase tracking-widest font-extrabold flex items-center justify-center gap-2 transition cursor-pointer ${
              activeTab === 'timelapse'
                ? 'bg-white text-brand-text shadow-sm rounded-lg border border-brand-border'
                : 'text-brand-muted hover:text-brand-text'
            }`}
          >
            <Video className="w-3.5 h-3.5" />
            <span>Timelapse Studio</span>
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'milestones' ? (
          <MilestonesList
            layers={layers}
            selectedLayerId={selectedLayerId}
            playbackIndex={playbackIndex}
            uploading={uploading}
            onDropFiles={handleDropFiles}
            onSelectLayer={(layerId) => {
              setIsPlaying(false);
              setPlaybackIndex(null);
              setSelectedLayerId(layerId);
            }}
            onMoveLayer={handleMoveLayer}
            onDeleteLayer={handleDeleteLayer}
            onRecalculateAlignment={handleRecalculateAlignment}
            onDeleteArtwork={handleDeleteArtwork}
          />
        ) : (
          <TimelapseStudio
            layers={layers}
            isPlaying={isPlaying}
            playbackIndex={playbackIndex}
            selectedLayerId={selectedLayerId}
            frameDelay={frameDelay}
            transitionEffect={transitionEffect}
            loopPlayback={loopPlayback}
            enableWebGPU={enableWebGPU}
            webGpuOptions={webGpuOptions}
            generating={generatingVideo}
            onTogglePlay={togglePlay}
            onStepFrame={stepFrame}
            onSetFrameDelay={setFrameDelay}
            onSetTransitionEffect={setTransitionEffect}
            onSetLoopPlayback={setLoopPlayback}
            onSetEnableWebGPU={setEnableWebGPU}
            onSetWebGpuOptions={setWebGpuOptions}
            onExportTimelapse={handleExportTimelapse}
          />
        )}
      </div>

      {/* Cropping & Perspective Alignment Modal */}
      <CropModal
        isOpen={cropModalOpen}
        imageSrc={currentCroppingImageSrc}
        baseLayerImageUrl={
          recalculatingLayer && recalculatingLayer.id !== baseLayer?.id
            ? baseLayer?.imageUrl
            : layers.length > 0 && !recalculatingLayer
            ? baseLayer?.imageUrl
            : undefined
        }
        onClose={() => {
          setCropModalOpen(false);
          setCurrentCroppingImageSrc(null);
          setRecalculatingLayer(null);
        }}
        onSave={handleSaveCroppedImage}
      />
    </div>
  );
}
