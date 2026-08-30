import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import {
  subscribeToLayers,
  createLayer,
  replaceLayerImage,
  updateLayersOrder,
  deleteLayer,
  deleteArtworkComplete,
} from '../lib/api';
import { createTimelapseTiming } from '../lib/workflow';
import { Artwork, Layer, WebGPUFilterOptions } from '../types';
import { ArtworkCanvas } from '../components/artwork/ArtworkCanvas';
import { MilestonesList } from '../components/artwork/MilestonesList';
import { TimelapseStudio } from '../components/artwork/TimelapseStudio';
import { CropModal } from '../components/artwork/CropModal';
import { Loader2, History, Video, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';

const VIDEO_WIDTH = 1920;
const VIDEO_HEIGHT = 1080;
const VIDEO_FPS = 30;
const VIDEO_BIT_RATE = 6_000_000;
const VIDEO_MIME_TYPE = 'video/webm;codecs=vp9';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export default function ArtworkPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [artwork, setArtwork] = useState<Artwork | null>(null);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'milestones' | 'timelapse'>('milestones');

  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState<number | null>(null);
  const [prevPlaybackIndex, setPrevPlaybackIndex] = useState<number | null>(null);
  const [frameDelay, setFrameDelay] = useState(500);
  const [transitionEffect, setTransitionEffect] = useState<'fade' | 'cut'>('fade');
  const [loopPlayback, setLoopPlayback] = useState(true);

  const [enableWebGPU, setEnableWebGPU] = useState(false);
  const [webGpuOptions, setWebGpuOptions] = useState<WebGPUFilterOptions>({
    brightness: 1,
    contrast: 1,
    saturation: 1,
  });

  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [currentCroppingImageSrc, setCurrentCroppingImageSrc] = useState<string | null>(null);
  const [recalculatingLayer, setRecalculatingLayer] = useState<Layer | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingFileIndex, setPendingFileIndex] = useState(0);
  const currentObjectUrlRef = useRef<string | null>(null);
  const nextLayerOrderRef = useRef(0);

  const revokeCurrentObjectUrl = useCallback(() => {
    if (currentObjectUrlRef.current) {
      URL.revokeObjectURL(currentObjectUrlRef.current);
      currentObjectUrlRef.current = null;
    }
  }, []);

  const showFileInCropper = useCallback(
    (file: File) => {
      revokeCurrentObjectUrl();
      const objectUrl = URL.createObjectURL(file);
      currentObjectUrlRef.current = objectUrl;
      setCurrentCroppingImageSrc(objectUrl);
      setCropModalOpen(true);
    },
    [revokeCurrentObjectUrl],
  );

  const closeCropSession = useCallback(() => {
    revokeCurrentObjectUrl();
    setCropModalOpen(false);
    setCurrentCroppingImageSrc(null);
    setRecalculatingLayer(null);
    setPendingFiles([]);
    setPendingFileIndex(0);
  }, [revokeCurrentObjectUrl]);

  useEffect(() => closeCropSession, [closeCropSession]);

  useEffect(() => {
    if (!id || !user) return;
    let active = true;

    const fetchArtwork = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const docSnap = await getDoc(doc(db, 'artworks', id));
        if (!active) return;
        if (!docSnap.exists()) {
          setLoadError('Artwork project not found.');
          return;
        }
        setArtwork({ id: docSnap.id, ...docSnap.data() } as Artwork);
      } catch (error) {
        if (!active) return;
        console.error('Fetch artwork error:', error);
        setLoadError(errorMessage(error));
      } finally {
        if (active) setLoading(false);
      }
    };

    void fetchArtwork();
    return () => {
      active = false;
    };
  }, [id, user]);

  useEffect(() => {
    if (!id || !user) return;
    return subscribeToLayers(
      id,
      (data) => {
        setLayers(data);
        setSelectedLayerId((current) => {
          if (data.length === 0) return null;
          if (current && data.some((layer) => layer.id === current)) return current;
          return data[data.length - 1].id;
        });
        setPlaybackIndex((current) =>
          current !== null && current >= data.length ? null : current,
        );
      },
      (error) => {
        console.error('Layer subscription error:', error);
        toast.error(`Milestones could not be synchronized: ${error.message}`);
      },
    );
  }, [id, user]);

  useEffect(() => {
    if (!isPlaying || layers.length === 0) return;
    const timer = window.setInterval(() => {
      setPlaybackIndex((previous) => {
        const current = previous ?? 0;
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
    return () => window.clearInterval(timer);
  }, [isPlaying, layers.length, frameDelay, loopPlayback]);

  const togglePlay = () => {
    if (layers.length < 2) {
      toast.error('Add at least 2 progress milestones to preview timelapse playback.');
      return;
    }
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    setPlaybackIndex(0);
    setPrevPlaybackIndex(null);
    setIsPlaying(true);
  };

  const stepFrame = (direction: -1 | 1) => {
    if (layers.length === 0) return;
    setIsPlaying(false);
    const selectedIndex = selectedLayerId ? layers.findIndex((layer) => layer.id === selectedLayerId) : -1;
    const currentIndex = playbackIndex ?? (selectedIndex >= 0 ? selectedIndex : layers.length - 1);
    const nextIndex = (currentIndex + direction + layers.length) % layers.length;
    setPrevPlaybackIndex(currentIndex);
    setPlaybackIndex(nextIndex);
    setSelectedLayerId(layers[nextIndex].id);
  };

  const convertHeicFile = async (file: File): Promise<File> => {
    const isHeic =
      file.type === 'image/heic' ||
      file.type === 'image/heif' ||
      /\.(heic|heif)$/i.test(file.name);
    if (!isHeic) return file;

    const { default: heic2any } = await import('heic2any');
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.95 });
    const convertedBlob = Array.isArray(converted) ? converted[0] : converted;
    if (!convertedBlob) throw new Error(`HEIC conversion returned no image for ${file.name}`);
    return new File([convertedBlob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  };

  const handleDropFiles = async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    setUploading(true);
    const toastId = toast.loading(`Preparing ${acceptedFiles.length} milestone${acceptedFiles.length === 1 ? '' : 's'}...`);

    try {
      const convertedFiles: File[] = [];
      for (const file of acceptedFiles) convertedFiles.push(await convertHeicFile(file));
      convertedFiles.sort((a, b) => a.lastModified - b.lastModified);

      const highestOrder = layers.reduce((maximum, layer) => Math.max(maximum, layer.order ?? -1), -1);
      nextLayerOrderRef.current = highestOrder + 1;
      setPendingFiles(convertedFiles);
      setPendingFileIndex(0);
      setRecalculatingLayer(null);
      showFileInCropper(convertedFiles[0]);
      toast.success(
        convertedFiles.length === 1
          ? 'Milestone ready to frame.'
          : `${convertedFiles.length} milestones queued in chronological order.`,
        { id: toastId },
      );
    } catch (error) {
      console.error('Drop files error:', error);
      closeCropSession();
      toast.error(errorMessage(error), { id: toastId });
    } finally {
      setUploading(false);
    }
  };

  const handleRecalculateAlignment = (layer: Layer) => {
    revokeCurrentObjectUrl();
    setPendingFiles([]);
    setPendingFileIndex(0);
    setCurrentCroppingImageSrc(layer.imageUrl);
    setRecalculatingLayer(layer);
    setCropModalOpen(true);
  };

  const handleSaveCroppedImage = async (croppedBlob: Blob) => {
    if (!id) throw new Error('Artwork route is missing its identifier.');

    if (recalculatingLayer) {
      await replaceLayerImage(id, recalculatingLayer.id, croppedBlob, recalculatingLayer.imageUrl);
      setRecalculatingLayer(null);
      setCropModalOpen(false);
      setCurrentCroppingImageSrc(null);
      return;
    }

    const sourceFile = pendingFiles[pendingFileIndex];
    if (!sourceFile) throw new Error('The milestone upload queue is inconsistent.');

    const createdAt = new Date(sourceFile.lastModified).toISOString();
    const newLayerId = await createLayer(
      id,
      croppedBlob,
      undefined,
      [],
      [],
      createdAt,
      nextLayerOrderRef.current,
    );
    nextLayerOrderRef.current += 1;
    setSelectedLayerId(newLayerId);

    const nextIndex = pendingFileIndex + 1;
    if (nextIndex < pendingFiles.length) {
      setPendingFileIndex(nextIndex);
      showFileInCropper(pendingFiles[nextIndex]);
      return;
    }
    closeCropSession();
  };

  const handleMoveLayer = async (index: number, direction: 'up' | 'down') => {
    if (!id) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= layers.length) return;

    const reorderedLayers = [...layers];
    const [moved] = reorderedLayers.splice(index, 1);
    reorderedLayers.splice(targetIndex, 0, moved);

    try {
      await updateLayersOrder(
        id,
        reorderedLayers.map((layer, order) => ({ id: layer.id, order })),
      );
      toast.success('Layer order updated');
    } catch (error) {
      console.error('Move layer error:', error);
      toast.error(errorMessage(error));
    }
  };

  const handleDeleteLayer = async (layerId: string, imageUrl: string) => {
    if (!id) return;
    try {
      await deleteLayer(id, layerId, imageUrl);
      toast.success('Milestone deleted');
    } catch (error) {
      console.error('Delete layer error:', error);
      toast.error(errorMessage(error));
    }
  };

  const handleDeleteArtwork = async () => {
    if (!id) return;
    try {
      await deleteArtworkComplete(id);
      toast.success('Artwork deleted');
      navigate('/dashboard');
    } catch (error) {
      console.error('Delete artwork error:', error);
      toast.error(errorMessage(error));
    }
  };

  const handleExportTimelapse = async () => {
    if (layers.length < 2) {
      toast.error('Upload at least 2 milestones to export a timelapse video.');
      return;
    }
    if (!MediaRecorder.isTypeSupported(VIDEO_MIME_TYPE)) {
      toast.error(`This browser cannot encode ${VIDEO_MIME_TYPE}.`);
      return;
    }

    setGeneratingVideo(true);
    const toastId = toast.loading('Rendering 1080p timelapse frames...');

    try {
      const loadedImages = await Promise.all(
        layers.map(
          (layer) =>
            new Promise<HTMLImageElement>((resolve, reject) => {
              const image = new Image();
              image.crossOrigin = 'anonymous';
              image.src = layer.imageUrl;
              image.onload = () => resolve(image);
              image.onerror = () => reject(new Error(`Failed to load frame ${layer.id}`));
            }),
        ),
      );

      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = VIDEO_WIDTH;
      exportCanvas.height = VIDEO_HEIGHT;
      const context = exportCanvas.getContext('2d');
      if (!context) throw new Error('Could not create video export canvas');

      const stream = exportCanvas.captureStream(VIDEO_FPS);
      const recorder = new MediaRecorder(stream, {
        mimeType: VIDEO_MIME_TYPE,
        videoBitsPerSecond: VIDEO_BIT_RATE,
      });
      const recordedChunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunks.push(event.data);
      };
      const recordPromise = new Promise<Blob>((resolve, reject) => {
        recorder.onerror = () => reject(new Error('MediaRecorder failed while encoding the timelapse.'));
        recorder.onstop = () => resolve(new Blob(recordedChunks, { type: 'video/webm' }));
      });

      const timing = createTimelapseTiming(frameDelay, transitionEffect, VIDEO_FPS);
      recorder.start();

      for (let index = 0; index < loadedImages.length; index += 1) {
        const image = loadedImages[index];
        const nextImage = loadedImages[index + 1];
        const scale = Math.min(VIDEO_WIDTH / image.width, VIDEO_HEIGHT / image.height);
        const x = (VIDEO_WIDTH - image.width * scale) / 2;
        const y = (VIDEO_HEIGHT - image.height * scale) / 2;

        context.globalAlpha = 1;
        context.fillStyle = '#1A1817';
        context.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
        context.drawImage(image, x, y, image.width * scale, image.height * scale);

        if (!nextImage || transitionEffect === 'cut') {
          await sleep(timing.frameDelayMs);
          continue;
        }

        await sleep(timing.holdMs);
        const nextScale = Math.min(VIDEO_WIDTH / nextImage.width, VIDEO_HEIGHT / nextImage.height);
        const nextX = (VIDEO_WIDTH - nextImage.width * nextScale) / 2;
        const nextY = (VIDEO_HEIGHT - nextImage.height * nextScale) / 2;

        for (let step = 1; step <= timing.transitionFrames; step += 1) {
          const alpha = step / timing.transitionFrames;
          context.fillStyle = '#1A1817';
          context.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
          context.globalAlpha = 1 - alpha;
          context.drawImage(image, x, y, image.width * scale, image.height * scale);
          context.globalAlpha = alpha;
          context.drawImage(nextImage, nextX, nextY, nextImage.width * nextScale, nextImage.height * nextScale);
          context.globalAlpha = 1;
          await sleep(timing.transitionStepMs);
        }
      }

      recorder.stop();
      const videoBlob = await recordPromise;
      const downloadUrl = URL.createObjectURL(videoBlob);
      try {
        const anchor = document.createElement('a');
        anchor.href = downloadUrl;
        anchor.download = `${artwork?.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'artwork'}_timelapse.webm`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(downloadUrl);
      }
      toast.success('Timelapse video generated and downloaded.', { id: toastId });
    } catch (error) {
      console.error('Export video error:', error);
      toast.error(errorMessage(error), { id: toastId });
    } finally {
      setGeneratingVideo(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 min-h-[70vh] flex items-center justify-center" role="status" aria-label="Loading artwork">
        <Loader2 className="w-8 h-8 animate-spin text-brand-accent" />
      </div>
    );
  }

  if (loadError || !artwork) {
    return (
      <div className="flex-1 min-h-[70vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-red-200 rounded-2xl p-6 text-center shadow-sm">
          <AlertTriangle className="w-8 h-8 text-red-600 mx-auto mb-3" />
          <h2 className="font-serif text-xl font-bold text-brand-text">Artwork unavailable</h2>
          <p className="text-sm text-brand-muted mt-2">{loadError ?? 'The artwork could not be loaded.'}</p>
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="mt-5 px-5 py-2 rounded-full bg-brand-text text-white text-xs font-bold uppercase tracking-wider hover:bg-black"
          >
            Back to portfolio
          </button>
        </div>
      </div>
    );
  }

  const selectedIndex = selectedLayerId ? layers.findIndex((layer) => layer.id === selectedLayerId) : -1;
  const currentDisplayIndex = playbackIndex ?? (selectedIndex >= 0 ? selectedIndex : layers.length - 1);
  const currentDisplayLayer = layers[currentDisplayIndex];
  const prevDisplayIndex = prevPlaybackIndex ?? -1;
  const baseLayer = layers[0];

  return (
    <div className="flex-1 flex flex-col md:flex-row h-auto md:h-[calc(100vh-80px)] overflow-y-auto md:overflow-hidden bg-[#FAF9F6]">
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
          onWebGpuError={(message) => {
            toast.error(`${message} WebGPU remains enabled; disable it in Timelapse Studio to use standard rendering.`);
          }}
        />
      </div>

      <div className="w-full md:w-96 border-t md:border-t-0 md:border-l border-brand-border bg-white flex flex-col h-auto md:h-full shadow-lg z-20">
        <div className="flex border-b border-brand-border bg-brand-surface/40 p-1" role="tablist" aria-label="Artwork tools">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'milestones'}
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
            type="button"
            role="tab"
            aria-selected={activeTab === 'timelapse'}
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
        onClose={closeCropSession}
        onSave={handleSaveCroppedImage}
      />
    </div>
  );
}
