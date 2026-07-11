import React, { useState, useEffect, useRef, useCallback } from 'react';
import heic2any from 'heic2any';
import { useParams, Link, useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { db, storage } from '../firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { subscribeToLayers, createLayer, deleteArtworkComplete, updateLayersOrder, deleteLayer } from '../lib/api';
import { Artwork, Layer } from '../types';
import { format } from 'date-fns';
import { ArrowLeft, Upload, Play, Download, Loader2, Sparkles, ImagePlus, Palette, Crop, Check, X, CheckSquare, Layers as LayersIcon, Image as ImageIcon, Trash2, Film, Sliders, Settings, SkipForward, SkipBack, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useDropzone } from 'react-dropzone';
import Cropper from 'react-easy-crop';
import { getCroppedImg } from '../lib/cropImage';

import { autoAlignImage, warpPerspectiveImage } from '../lib/autoAlign';
import { safeJsonParse } from '../lib/utils';

export default function ArtworkPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [artwork, setArtwork] = useState<Artwork | null>(null);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState<number | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [detectingBounds, setDetectingBounds] = useState(false);

  // New states for Timelapse Options
  const [activeTab, setActiveTab] = useState<'milestones' | 'timelapse'>('timelapse'); 
  const [frameDelay, setFrameDelay] = useState<number>(500); 
  const [transitionEffect, setTransitionEffect] = useState<'fade' | 'cut'>('fade');
  const [loopMode, setLoopMode] = useState<boolean>(true);

  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);

  // Crop modes and coordinates for the Perspective transform
  const [cropMode, setCropMode] = useState<'standard' | 'perspective'>('standard');
  const [perspectivePoints, setPerspectivePoints] = useState<Array<{ x: number; y: number }>>([
    { x: 0.15, y: 0.15 }, // TL
    { x: 0.85, y: 0.15 }, // TR
    { x: 0.85, y: 0.85 }, // BR
    { x: 0.15, y: 0.85 }  // BL
  ]);
  const [activePointIndex, setActivePointIndex] = useState<number | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0, left: 0, top: 0 });

  // States for Cropper / image cropping sequence before upload & alignment
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingFileIndex, setPendingFileIndex] = useState<number>(0);
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
  const [currentUploadedLatestUrl, setCurrentUploadedLatestUrl] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<number | undefined>(undefined);
  const [originalAspect, setOriginalAspect] = useState<number | undefined>(undefined);

  const [deletingLayerId, setDeletingLayerId] = useState<string | null>(null);
  const webGPUCanvasRef = useRef<HTMLCanvasElement>(null);
  const [enableWebGPU, setEnableWebGPU] = useState<boolean>(false);
  const [webGPUBrightness, setWebGPUBrightness] = useState<number>(1.0);
  const [webGPUContrast, setWebGPUContrast] = useState<number>(1.0);
  const [webGPUSaturation, setWebGPUSaturation] = useState<number>(1.0);
  const [autoAlignEnabled, setAutoAlignEnabled] = useState<boolean>(true);
  const [snapToEdgesEnabled, setSnapToEdgesEnabled] = useState<boolean>(true);
  const edgeGridRef = useRef<{
    width: number;
    height: number;
    magnitude: Float32Array;
  } | null>(null);

  // Generate High-Precision local Sobel gradient maps for real-time edge-snapping on the client
  useEffect(() => {
    if (!imageToCrop) {
      edgeGridRef.current = null;
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        // Downsample slightly for incredible micro-second execution
        const maxDim = 400;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          const ratio = maxDim / Math.max(w, h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;

        const gray = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) {
          const r = data[i * 4];
          const g = data[i * 4 + 1];
          const b = data[i * 4 + 2];
          gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
        }

        const magnitude = new Float32Array(w * h);

        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const gx =
              -1 * gray[(y - 1) * w + (x - 1)] + 1 * gray[(y - 1) * w + (x + 1)] +
              -2 * gray[y * w + (x - 1)] + 2 * gray[y * w + (x + 1)] +
              -1 * gray[(y + 1) * w + (x - 1)] + 1 * gray[(y + 1) * w + (x + 1)];

            const gy =
              -1 * gray[(y - 1) * w + (x - 1)] - 2 * gray[(y - 1) * w + x] - 1 * gray[(y - 1) * w + (x + 1)] +
              1 * gray[(y + 1) * w + (x - 1)] + 2 * gray[(y + 1) * w + x] + 1 * gray[(y + 1) * w + (x + 1)];

            magnitude[y * w + x] = Math.hypot(gx, gy);
          }
        }

        edgeGridRef.current = { width: w, height: h, magnitude };
      } catch (err) {
        console.error("Failed to build edge snap map:", err);
        edgeGridRef.current = null;
      }
    };
    img.src = imageToCrop;
  }, [imageToCrop]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const preloadedUrlsRef = useRef<Set<string>>(new Set());

  // Dynamically measure the original aspect ratio of the image once it stands ready to crop
  useEffect(() => {
    if (imageToCrop) {
      const img = new Image();
      img.onload = () => {
        const measuredRatio = img.naturalWidth / img.naturalHeight;
        setOriginalAspect(measuredRatio);
        // Default to original image ratio to allow selecting the full height/width of their painting!
        setAspectRatio(measuredRatio);
      };
      img.src = imageToCrop;
    } else {
      setOriginalAspect(undefined);
    }
  }, [imageToCrop]);

  useEffect(() => {
    if (!isPlaying || layers.length === 0) {
      setPlaybackIndex(null);
      return;
    }
    
    // Smoothly initialize playback index from the frame currently selected
    setPlaybackIndex(prev => {
      if (prev !== null) return prev;
      const startIdx = selectedLayerId ? layers.findIndex(l => l.id === selectedLayerId) : -1;
      return startIdx >= 0 ? startIdx : layers.length - 1;
    });

    const interval = setInterval(() => {
      setPlaybackIndex((prev) => {
        const currentIdx = prev !== null ? prev : 0;
        if (currentIdx >= layers.length - 1) {
          if (loopMode) {
            return 0; // Loop back
          } else {
            setIsPlaying(false);
            return currentIdx;
          }
        }
        return currentIdx + 1;
      });
    }, frameDelay);

    return () => clearInterval(interval);
  }, [isPlaying, layers.length, frameDelay, loopMode, selectedLayerId]);

  useEffect(() => {
    if (!id || !user) return;
    
    // Fetch artwork details
    getDoc(doc(db, 'artworks', id)).then(snap => {
      if (snap.exists() && snap.data().ownerId === user.uid) {
        setArtwork({ id: snap.id, ...snap.data() } as Artwork);
      } else {
        toast.error("Artwork not found");
      }
    }).catch(err => {
      console.warn("Could not fetch artwork. It may be offline or you don't have permission.", err);
      toast.error("Failed to load artwork details. Retrying...");
    });

    // Subscribe to layers with optimistic bypass/SSOT
    const unsubscribeLayers = subscribeToLayers(id, user.uid, (data) => {
      setLayers(data);
      setLoading(false);
    });

    return () => {
      unsubscribeLayers();
    };
  }, [id, user]);

  // Preload all layers' images upon retrieval to secure seamless flash-free caching
  useEffect(() => {
    if (layers.length > 0) {
      layers.forEach((layer) => {
        if (layer.imageUrl && !preloadedUrlsRef.current.has(layer.imageUrl)) {
          preloadedUrlsRef.current.add(layer.imageUrl);
          const img = new Image();
          img.src = layer.imageUrl;
        }
      });
    }
  }, [layers]);

  const handleDeleteArtwork = async () => {
    if (!id) return;
    const toastId = toast.loading('Deleting project and progress photos...');
    try {
      await deleteArtworkComplete(id);
      toast.success('Project deleted successfully', { id: toastId });
      navigate('/dashboard');
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to delete project', { id: toastId });
    }
  };

  const downscaleDataUrl = async (dataUrl: string, maxDim = 800): Promise<string> => {
    if (!dataUrl || !dataUrl.startsWith("data:")) return dataUrl;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.85));
        } else {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  };

  const handleAIDetectBounds = async (imgUrlToAnalyze?: string, method: 'opencv' | 'gemini' = 'opencv') => {
    const targetUrl = imgUrlToAnalyze || imageToCrop;
    if (!targetUrl) return;
    
    setDetectingBounds(true);
    if (method === 'gemini') {
      toast.loading("AI Auto-Detecting painting canvas borders using Gemini...", { id: "ai-detect" });
    } else {
      toast.loading("Analyzing painting canvas borders using computer vision...", { id: "ai-detect" });
    }
    
    try {
      // Fetch or read image dimension details dynamically to prevent async race conditions with standard loads
      const { naturalWidth, naturalHeight } = await new Promise<{ naturalWidth: number; naturalHeight: number }>((resolve, reject) => {
        const imgObj = new Image();
        imgObj.crossOrigin = "anonymous";
        imgObj.onload = () => resolve({ naturalWidth: imgObj.naturalWidth, naturalHeight: imgObj.naturalHeight });
        imgObj.onerror = () => reject(new Error("Failed to measure original image dimensions."));
        imgObj.src = targetUrl;
      });

      let processedUrl = targetUrl;
      if (targetUrl.startsWith("data:")) {
        try {
          processedUrl = await downscaleDataUrl(targetUrl, 800);
        } catch (scaleErr) {
          console.warn("Client downscaling error:", scaleErr);
        }
      }

      const res = await fetch("/api/detect-canvas-bounds", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ image: processedUrl, method })
      });

      if (!res.ok) {
        // Log status first, then try to extract message. Let's use safeJsonParse to extract detail if any.
        const errData = await safeJsonParse(res).catch(() => ({}));
        throw new Error(errData.error || (method === 'gemini' ? "Failed to communicate with Gemini API" : "Failed to communicate with local computer vision"));
      }

      const data = await safeJsonParse(res);
      if (data.success && data.bounds) {
        const { ymin, xmin, ymax, xmax } = data.bounds;

        if (ymax > ymin && xmax > xmin) {
          const w = xmax - xmin;
          const h = ymax - ymin;
          
          // Calculate recommended zoom
          const calculatedZoom = Math.min(Math.max(1 / Math.max(w, h), 1), 3);
          
          // Calculate crop offset in easy-crop coordinates (percent)
          const calculatedCropX = (0.5 - (xmin + xmax) / 2) * 100 * calculatedZoom;
          const calculatedCropY = (0.5 - (ymin + ymax) / 2) * 100 * calculatedZoom;

          // Compute absolute pixels for CroppedAreaPixels to ensure direct crop works immediately without user touch
          const targetX = Math.round(xmin * naturalWidth);
          const targetY = Math.round(ymin * naturalHeight);
          const targetW = Math.round(w * naturalWidth);
          const targetH = Math.round(h * naturalHeight);

          const autoCroppedPixels = {
            x: targetX,
            y: targetY,
            width: targetW,
            height: targetH
          };

          // Synchronize both standard EasyCrop visual boundaries and underlying saving coordinates
          setZoom(calculatedZoom);
          setCrop({ x: calculatedCropX, y: calculatedCropY });
          setCroppedAreaPixels(autoCroppedPixels);

          // Bootstrap the 4 perspective points to matching coordinates
          setPerspectivePoints([
            { x: xmin, y: ymin }, // TL
            { x: xmax, y: ymin }, // TR
            { x: xmax, y: ymax }, // BR
            { x: xmin, y: ymax }  // BL
          ]);

          // Auto-frame with proportional aspect ratio of the detected canvas painting shape
          setAspectRatio(targetW / targetH);

          if (data.mode === "opencv") {
            toast.success("Aligned perfectly using high-performance local computer vision!", { id: "ai-detect" });
          } else {
            toast.success("AI accurately aligned to painting borders!", { id: "ai-detect" });
          }
        } else {
          throw new Error(method === 'gemini' ? "Invalid boundaries from Gemini" : "Invalid boundaries from computer vision");
        }
      } else {
        throw new Error(data.error || (method === 'gemini' ? "Gemini could not identify canvas bounds" : "Computer vision could not identify canvas bounds"));
      }
    } catch (err: any) {
      console.warn(err);
      toast.error(err.message || "Failed to locate canvas automatically. Adjust crop manually.", { id: "ai-detect" });
    } finally {
      setDetectingBounds(false);
    }
  };

  const updateContainerDimensions = useCallback(() => {
    if (imgRef.current) {
      const rect = imgRef.current.getBoundingClientRect();
      const parentElement = imgRef.current.parentElement;
      if (parentElement) {
        const parentRect = parentElement.getBoundingClientRect();
        setContainerSize({
          width: rect.width,
          height: rect.height,
          left: rect.left - parentRect.left,
          top: rect.top - parentRect.top
        });
      }
    }
  }, []);

  const snapToEdges = useCallback((normalizedX: number, normalizedY: number): { x: number; y: number } => {
    let finalX = Number(normalizedX.toFixed(4));
    let finalY = Number(normalizedY.toFixed(4));

    // 1. Boundary Snapping: Snap to exact 0.0 or 1.0 if we are within 0.02 of the outer image bounds
    if (Math.abs(finalX) < 0.02) finalX = 0;
    else if (Math.abs(finalX - 1) < 0.02) finalX = 1;

    if (Math.abs(finalY) < 0.02) finalY = 0;
    else if (Math.abs(finalY - 1) < 0.02) finalY = 1;

    // 2. High-Precision Local Edge Snapping (using Sobel gradients)
    if (snapToEdgesEnabled && edgeGridRef.current) {
      const { width: w, height: h, magnitude } = edgeGridRef.current;

      // Only attempt local edge-snapping if the point is within the image bounds (with brief 0.05 bleed margin)
      if (normalizedX >= -0.05 && normalizedX <= 1.05 && normalizedY >= -0.05 && normalizedY <= 1.05) {
        const mapX = Math.round(normalizedX * w);
        const mapY = Math.round(normalizedY * h);

        const searchRadius = 16;
        let bestX = mapX;
        let bestY = mapY;
        let maxVal = 0;

        for (let dy = -searchRadius; dy <= searchRadius; dy++) {
          for (let dx = -searchRadius; dx <= searchRadius; dx++) {
            const nx = mapX + dx;
            const ny = mapY + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              const val = magnitude[ny * w + nx];
              if (val > maxVal) {
                maxVal = val;
                bestX = nx;
                bestY = ny;
              }
            }
          }
        }

        // High gradient value means a true physical contrast line (edge) is present
        const edgeThreshold = 55;
        if (maxVal > edgeThreshold) {
          finalX = Number((bestX / w).toFixed(4));
          finalY = Number((bestY / h).toFixed(4));
        }
      }
    }

    return { x: finalX, y: finalY };
  }, [snapToEdgesEnabled]);

  // Global cursor tracker during dragging. 
  // It guarantees ultra-responsive handling even if cursor moves outside the viewport or iframe!
  useEffect(() => {
    if (activePointIndex === null) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      if (!imgRef.current) return;
      const rect = imgRef.current.getBoundingClientRect();
      let x = (e.clientX - rect.left) / rect.width;
      let y = (e.clientY - rect.top) / rect.height;

      // Allow dragging corners outside the image (with a generous canvas bleed boundary)
      x = Math.max(-0.4, Math.min(1.4, x));
      y = Math.max(-0.4, Math.min(1.4, y));

      const snapped = snapToEdges(x, y);

      setPerspectivePoints(prev => {
        const updated = [...prev];
        updated[activePointIndex] = snapped;
        return updated;
      });
    };

    const handleWindowTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 0 || !imgRef.current) return;
      // Prevent browser default pull-to-refresh / scrolling
      if (e.cancelable) {
        e.preventDefault();
      }
      const rect = imgRef.current.getBoundingClientRect();
      let x = (e.touches[0].clientX - rect.left) / rect.width;
      let y = (e.touches[0].clientY - rect.top) / rect.height;

      // Allow dragging corners outside the image
      x = Math.max(-0.4, Math.min(1.4, x));
      y = Math.max(-0.4, Math.min(1.4, y));

      const snapped = snapToEdges(x, y);

      setPerspectivePoints(prev => {
        const updated = [...prev];
        updated[activePointIndex] = snapped;
        return updated;
      });
    };

    const handleWindowEnd = () => {
      setActivePointIndex(null);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowEnd);
    window.addEventListener('touchmove', handleWindowTouchMove, { passive: false });
    window.addEventListener('touchend', handleWindowEnd);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowEnd);
      window.removeEventListener('touchmove', handleWindowTouchMove);
      window.removeEventListener('touchend', handleWindowEnd);
    };
  }, [activePointIndex, snapToEdges]);

  const handleDragMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    // Overridden by window event listeners for ultra-smooth rendering
  }, []);

  const handleEndDrag = useCallback(() => {
    setActivePointIndex(null);
  }, []);

  useEffect(() => {
    if (imageToCrop) {
      window.addEventListener('resize', updateContainerDimensions);
      const timeoutId = setTimeout(updateContainerDimensions, 150);
      return () => {
        window.removeEventListener('resize', updateContainerDimensions);
        clearTimeout(timeoutId);
      };
    }
  }, [imageToCrop, cropMode, updateContainerDimensions]);

  // Reset crop and zoom first when a new image is loaded for cropping (NO automatic bounds detection)
  useEffect(() => {
    if (imageToCrop) {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setPerspectivePoints([
        { x: 0.15, y: 0.15 }, // TL
        { x: 0.85, y: 0.15 }, // TR
        { x: 0.85, y: 0.85 }, // BR
        { x: 0.15, y: 0.85 }  // BL
      ]);
    }
  }, [imageToCrop]);

  const onCropComplete = useCallback((_croppedArea: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const onDrop = async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0 || !id || !artwork) return;
    
    // Filter to only image types in case the user picked from a broad documents/files list
    const imageFiles = acceptedFiles.filter(file => {
      const ext = file.name.split('.').pop()?.toLowerCase();
      const isImg = file.type.startsWith('image/') || 
        ['jpeg', 'jpg', 'png', 'gif', 'webp', 'heic', 'heif'].includes(ext || '');
      return isImg;
    });

    if (imageFiles.length === 0) {
      toast.error("Please select valid image files.");
      return;
    }

    if (imageFiles.length < acceptedFiles.length) {
      toast(`Filtered out ${acceptedFiles.length - imageFiles.length} non-image file(s).`, { icon: '⚠️' });
    }

    const processedFiles: File[] = [];
    let hasHeic = false;

    for (const file of imageFiles) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      const isHeic = ext === 'heic' || ext === 'heif' || file.type === 'image/heic' || file.type === 'image/heif';
      if (isHeic) {
        hasHeic = true;
      }
    }

    let loadingToastId: string | undefined;
    if (hasHeic) {
      loadingToastId = toast.loading("Processing HEIC live photo from your gallery...");
    }

    try {
      for (const file of imageFiles) {
        const ext = file.name.split('.').pop()?.toLowerCase();
        const isHeic = ext === 'heic' || ext === 'heif' || file.type === 'image/heic' || file.type === 'image/heif';

        if (isHeic) {
          try {
            const convertedBlob = await heic2any({
              blob: file,
              toType: 'image/jpeg',
              quality: 0.85
            });

            const blobToUse = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
            const newName = file.name.replace(/\.(heic|heif)$/i, '') + '.jpg';
            const convertedFile = new File([blobToUse], newName, { 
              type: 'image/jpeg',
              lastModified: file.lastModified 
            });
            processedFiles.push(convertedFile);
          } catch (heicErr) {
            console.error("Failed to convert HEIC/HEIF file: ", heicErr);
            processedFiles.push(file);
          }
        } else {
          processedFiles.push(file);
        }
      }

      if (loadingToastId) {
        toast.success("HEIC photo format converted to JPEG successfully!", { id: loadingToastId });
      }
    } catch (err) {
      console.error("Conversion error: ", err);
      if (loadingToastId) {
        toast.error("Error standardizing your photo format.", { id: loadingToastId });
      }
    }
    
    // Sort files strictly by actual disk modification/taking timestamp chronologically
    const sortedFiles = [...processedFiles].sort((a, b) => a.lastModified - b.lastModified);
    
    setPendingFiles(sortedFiles);
    setPendingFileIndex(0);
    setCurrentUploadedLatestUrl(layers.length > 0 ? layers[layers.length - 1].imageUrl : null);
    
    const file = sortedFiles[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setImageToCrop(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCropConfirm = async () => {
    if (!imageToCrop || !id) return;
    if (cropMode === 'standard' && !croppedAreaPixels) return;
    
    setUploading(true);
    
    try {
      let croppedBlob: Blob;
      if (cropMode === 'perspective') {
        const sourceInput = editingLayerId ? imageToCrop : (pendingFiles[pendingFileIndex] || imageToCrop);
        croppedBlob = await warpPerspectiveImage(sourceInput, perspectivePoints);
      } else {
        // 1. Crop image using the getCroppedImg helper
        croppedBlob = await getCroppedImg(imageToCrop, croppedAreaPixels);
      }
      
      let fileToUpload: File;
      if (editingLayerId) {
        fileToUpload = new File([croppedBlob], "realigned_layer.jpeg", { type: 'image/jpeg' });
      } else {
        const originalFile = pendingFiles[pendingFileIndex];
        const filename = originalFile ? originalFile.name.replace(/\.[^/.]+$/, "") : "milestone";
        fileToUpload = new File([croppedBlob], `${filename}_cropped.jpeg`, { type: 'image/jpeg' });
      }
      
      let alignedFile: File | Blob = fileToUpload;
      
      // 2. Perform alignment if there is a base layer
      let targetBaseLayerUrl: string | null = null;
      if (editingLayerId) {
        const editIndex = layers.findIndex(l => l.id === editingLayerId);
        if (editIndex > 0) {
          targetBaseLayerUrl = layers[editIndex - 1].imageUrl;
        }
      } else {
        targetBaseLayerUrl = currentUploadedLatestUrl;
      }

      if (targetBaseLayerUrl && autoAlignEnabled) {
        toast.loading(`Auto-aligning cropped layer...`, { id: 'upload' });
        try {
          const alignedBlob = await autoAlignImage({
            baseImgUrl: targetBaseLayerUrl,
            targetFile: fileToUpload
          });
          alignedFile = new File([alignedBlob], editingLayerId ? "realigned_layer.png" : pendingFiles[pendingFileIndex].name.replace(/\.[^/.]+$/, "") + "_aligned.png", { type: 'image/png' });
        } catch (alignErr: any) {
          console.warn("Auto-alignment failed, utilizing cropped image directly:", alignErr);
          toast.error(`Auto-alignment skipped: ${alignErr.message || "features too different"}. Saving cropped image directly!`, {
            id: 'upload',
            duration: 6000
          });
          alignedFile = fileToUpload;
        }
      }
      
      // 3. Process and upload/update
      if (editingLayerId) {
        toast.loading(`Updating milestone image...`, { id: 'upload' });
        
        // Upload the new cropped/aligned file
        const formData = new FormData();
        formData.append("file", alignedFile as File);
        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        if (!uploadRes.ok) {
          const errData = await safeJsonParse(uploadRes).catch(() => ({}));
          throw new Error(errData.error || "Failed to upload the updated layer image");
        }
        const { url: uploadedUrl } = await safeJsonParse(uploadRes);
        
        // Retrieve old image url for cleanup
        const oldLayer = layers.find(l => l.id === editingLayerId);
        const oldImageUrl = oldLayer?.imageUrl;

        // Update the Firestore doc
        await updateDoc(doc(db, `artworks/${id}/layers`, editingLayerId), {
          imageUrl: uploadedUrl
        });

        // Cleanup old image if different
        if (oldImageUrl && oldImageUrl !== uploadedUrl) {
          await fetch("/api/cleanup-files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ urls: [oldImageUrl] })
          }).catch(err => console.error("Failed to request old file cleanup:", err));
        }

        toast.success("Successfully updated and aligned milestone!", { id: 'upload' });
        setEditingLayerId(null);
        setImageToCrop(null);
        setCroppedAreaPixels(null);
        setZoom(1);
        setCrop({ x: 0, y: 0 });
      } else {
        // Normal Upload Mode
        // Compute precise sequential order index by finding the current highest order index in existing layers
        const maxOrder = layers.reduce((max, l) => (l.order !== undefined && l.order > max ? l.order : max), -1);
        const orderIndex = maxOrder + 1;
        const originalFile = pendingFiles[pendingFileIndex];
        const uploadedUrl = await processAndUploadFile(alignedFile as File, pendingFileIndex + 1, pendingFiles.length, originalFile, orderIndex);
        
        if (uploadedUrl) {
          setCurrentUploadedLatestUrl(uploadedUrl);
        }
        
        const nextIdx = pendingFileIndex + 1;
        if (nextIdx < pendingFiles.length) {
          setPendingFileIndex(nextIdx);
          const reader = new FileReader();
          reader.onload = () => {
            setImageToCrop(reader.result as string);
          };
          reader.readAsDataURL(pendingFiles[nextIdx]);
        } else {
          setPendingFiles([]);
          setPendingFileIndex(0);
          setImageToCrop(null);
          setCroppedAreaPixels(null);
          setZoom(1);
          setCrop({ x: 0, y: 0 });
          setCurrentUploadedLatestUrl(null);
          toast.success("Successfully cropped and aligned all layers!", { id: 'upload' });
        }
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to process image crop", { id: 'upload' });
    } finally {
      setUploading(false);
    }
  };

  const handleCancelCrop = () => {
    setPendingFiles([]);
    setPendingFileIndex(0);
    setImageToCrop(null);
    setCroppedAreaPixels(null);
    setZoom(1);
    setCrop({ x: 0, y: 0 });
    setCurrentUploadedLatestUrl(null);
    setEditingLayerId(null);
  };

  const processAndUploadFile = async (fileToUpload: File, currentIdx: number, total: number, originalFile: File, orderIndex: number) => {
    toast.loading(`Uploading layer ${currentIdx}/${total}...`, { id: 'upload' });

    const formData = new FormData();
    formData.append("file", fileToUpload);

    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const errData = await safeJsonParse(res).catch(() => ({}));
      throw new Error(errData.error || "Failed to upload to server");
    }

    const data = await safeJsonParse(res);
    const downloadUrl = data.url;

    // Persist actual timeline order status & the exact timestamp when photo was captured
    const customCreatedAt = new Date(originalFile.lastModified).toISOString();
    await createLayer(id!, downloadUrl, undefined, [], [], customCreatedAt, orderIndex);
    
    if (total === 1) toast.success("Layer added successfully!", { id: 'upload' });
    return downloadUrl;
  };

  const handleMoveLayer = async (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= layers.length) return;

    const newLayers = [...layers];
    const temp = newLayers[index];
    newLayers[index] = newLayers[targetIndex];
    newLayers[targetIndex] = temp;

    setIsPlaying(false);
    // Optimistic UI state update (complying with Single Source of Truth as it aligns with batch commit target)
    setLayers(newLayers);

    toast.loading("Reordering milestones...", { id: 'reorder' });
    try {
      const updates = newLayers.map((layer, i) => ({ id: layer.id, order: i }));
      await updateLayersOrder(id!, updates);
      toast.success("Milestones reordered!", { id: 'reorder' });
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to reorder milestones", { id: 'reorder' });
    }
  };

  const handleDeleteLayer = async (layerId: string, imageUrl: string) => {
    toast.loading("Deleting milestone...", { id: 'delete-layer' });
    try {
      await deleteLayer(id!, layerId, imageUrl);
      toast.success("Progress milestone deleted!", { id: 'delete-layer' });
      setSelectedLayerId(null);
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to delete milestone", { id: 'delete-layer' });
    }
  };



  const { getRootProps, getInputProps, isDragActive } = useDropzone(({ 
    onDrop, 
    accept: { 
      'image/jpeg': ['.jpeg', '.jpg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
      'image/gif': ['.gif'],
      'image/heic': ['.heic'],
      'image/heif': ['.heif']
    },
    multiple: true,
    disabled: uploading
  } as any));

  const stepBackward = () => {
    setIsPlaying(false);
    if (layers.length === 0) return;
    const currentIndex = selectedLayerId ? layers.findIndex(l => l.id === selectedLayerId) : layers.length - 1;
    const nextIndex = currentIndex <= 0 ? layers.length - 1 : currentIndex - 1;
    setSelectedLayerId(layers[nextIndex]?.id || null);
  };

  const stepForward = () => {
    setIsPlaying(false);
    if (layers.length === 0) return;
    const currentIndex = selectedLayerId ? layers.findIndex(l => l.id === selectedLayerId) : layers.length - 1;
    const nextIndex = currentIndex >= layers.length - 1 ? 0 : currentIndex + 1;
    setSelectedLayerId(layers[nextIndex]?.id || null);
  };

  const generateTimelapse = async () => {
    if (layers.length < 2) {
      toast.error("Need at least 2 layers to generate a timelapse.");
      return;
    }
    
    setGenerating(true);
    toast.loading("Generating high-res timelapse...", { id: 'timelapse' });
    
    try {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error("Canvas missing");
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Canvas ctx missing");

      // Load all images
      const imgs = await Promise.all(layers.map(layer => {
        return new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = layer.imageUrl.startsWith("http") ? `/api/proxy-image?url=${encodeURIComponent(layer.imageUrl)}` : layer.imageUrl;
        });
      }));

      // Set canvas to highest resolution amongst images
      const maxWidth = Math.max(...imgs.map(i => i.width));
      const maxHeight = Math.max(...imgs.map(i => i.height));
      canvas.width = maxWidth;
      canvas.height = maxHeight;

      const stream = canvas.captureStream(30);
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
      const chunks: BlobPart[] = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const file = new File([blob], `timelapse_${artwork?.title.replace(/\s+/g, '_')}.webm`, { type: 'video/webm' });
        
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({
              files: [file],
              title: `${artwork?.title} Timelapse`,
              text: 'Check out my artistic workflow timelapse!'
            });
            toast.success("Shared successfully!", { id: 'timelapse' });
          } catch (e) {
            // Fallback to download if share is cancelled or fails
            downloadFallback(blob);
          }
        } else {
          downloadFallback(blob);
        }
        setGenerating(false);
      };

      const downloadFallback = (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `timelapse_${artwork?.title.replace(/\s+/g, '_')}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success("Timelapse downloaded!", { id: 'timelapse' });
      };

      mediaRecorder.start();

      for (let i = 0; i < imgs.length; i++) {
        const imgCurr = imgs[i];
        const scaleCurr = Math.min(canvas.width / imgCurr.width, canvas.height / imgCurr.height);
        const wCurr = imgCurr.width * scaleCurr;
        const hCurr = imgCurr.height * scaleCurr;
        const xCurr = (canvas.width - wCurr) / 2;
        const yCurr = (canvas.height - hCurr) / 2;

        if (transitionEffect === 'fade' && i > 0) {
          const imgPrev = imgs[i - 1];
          const scalePrev = Math.min(canvas.width / imgPrev.width, canvas.height / imgPrev.height);
          const wPrev = imgPrev.width * scalePrev;
          const hPrev = imgPrev.height * scalePrev;
          const xPrev = (canvas.width - wPrev) / 2;
          const yPrev = (canvas.height - hPrev) / 2;

          // Cross-dissolve: fade out previous image and fade in current image smoothly
          const steps = 15;
          for (let step = 0; step <= steps; step++) {
            const alpha = step / steps;
            
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.globalAlpha = 1 - alpha;
            ctx.drawImage(imgPrev, xPrev, yPrev, wPrev, hPrev);

            ctx.globalAlpha = alpha;
            ctx.drawImage(imgCurr, xCurr, yCurr, wCurr, hCurr);

            await new Promise(r => setTimeout(r, 20)); // frame steps
          }
        }

        // Draw current image fully opaque and hold for the configured hold duration
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1;
        ctx.drawImage(imgCurr, xCurr, yCurr, wCurr, hCurr);
        
        await new Promise(r => setTimeout(r, frameDelay));
      }
      
      mediaRecorder.stop();
      
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to generate timelapse", { id: 'timelapse' });
      setGenerating(false);
    }
  };

  const latestLayer = layers[layers.length - 1];

  const currentDisplayIndex = isPlaying && playbackIndex !== null 
    ? playbackIndex 
    : (selectedLayerId ? layers.findIndex(l => l.id === selectedLayerId) : -1);

  const prevDisplayIndex = isPlaying && playbackIndex !== null
    ? (playbackIndex === 0 ? (loopMode ? layers.length - 1 : -1) : playbackIndex - 1)
    : -1;

  const currentDisplayLayer = (currentDisplayIndex >= 0 && currentDisplayIndex < layers.length)
    ? layers[currentDisplayIndex]
    : latestLayer;

  const currentLayerIndex = currentDisplayLayer 
    ? layers.findIndex(l => l.id === currentDisplayLayer.id) 
    : -1;

  // High fidelity WebGPU render pass execution effect when active frame state or controls modify
  useEffect(() => {
    if (!enableWebGPU || !webGPUCanvasRef.current) return;

    // Detect if browser actively supports WebGPU, throwing a high precision toast error on failure
    const customNavigator = navigator as any;
    if (!customNavigator.gpu) {
      toast.error("WebGPU is not supported by your browser or graphics hardware.");
      setEnableWebGPU(false);
      return;
    }

    const canvas = webGPUCanvasRef.current;
    
    // Find current active frame image URL
    const activeLayer = layers[currentDisplayIndex >= 0 ? currentDisplayIndex : (layers.length - 1)];
    if (!activeLayer?.imageUrl) return;

    let active = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    // Proxy URL to prevent security constraints on external buckets or local static paths
    img.src = activeLayer.imageUrl.startsWith("http")
      ? `/api/proxy-image?url=${encodeURIComponent(activeLayer.imageUrl)}`
      : activeLayer.imageUrl;

    img.onload = async () => {
      if (!active) return;
      try {
        const { renderImageWithWebGPU } = await import('../lib/webgpuFilter');
        await renderImageWithWebGPU(canvas, img, {
          brightness: webGPUBrightness,
          contrast: webGPUContrast,
          saturation: webGPUSaturation,
        });
      } catch (gpuErr: any) {
        console.error("WebGPU error:", gpuErr);
        toast.error(`WebGPU pipeline failed: ${gpuErr.message || gpuErr}. Disabling GPU acceleration.`);
        setEnableWebGPU(false);
      }
    };

    img.onerror = () => {
      if (!active) return;
      console.error("WebGPU frame render error for URL: " + activeLayer.imageUrl);
      toast.error("Failed to load frame into high-performance GPU textures.");
    };

    return () => {
      active = false;
    };
  }, [enableWebGPU, layers, currentDisplayIndex, webGPUBrightness, webGPUContrast, webGPUSaturation]);

  if (loading || !artwork) {
    return <div className="py-20 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-brand-accent" /></div>;
  }

  return (
    <div className="flex flex-col md:flex-row h-auto md:h-[calc(100vh-5rem)] w-full bg-brand-bg relative overflow-y-auto md:overflow-hidden">
      <aside className="hidden md:flex w-16 border-r border-brand-border flex-col items-center py-8 gap-10 bg-white">
        <Link to="/dashboard" className="w-10 h-10 rounded-xl hover:bg-brand-surface flex items-center justify-center text-brand-muted hover:text-brand-text transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="w-10 h-10 rounded-xl bg-brand-accent/10 flex items-center justify-center text-brand-accent">
          <Palette className="w-5 h-5" />
        </div>
        <div className="[writing-mode:vertical-rl] rotate-180 text-[10px] uppercase tracking-[0.3em] font-bold text-brand-muted mt-8">
          Session {artwork.id.substring(0, 4)} &mdash; {artwork.title}
        </div>
      </aside>

      <section className="flex-shrink-0 md:flex-1 h-[50vh] md:h-full relative bg-brand-surface flex items-center justify-center p-4 sm:p-12 overflow-hidden">
        <Link to="/dashboard" className="md:hidden absolute top-4 left-4 z-20 w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-md">
           <ArrowLeft className="w-5 h-5 text-brand-text" />
        </Link>
        <div className="relative w-full max-w-4xl h-full md:min-h-[60vh] md:max-h-[85vh] shadow-2xl rounded-sm overflow-hidden bg-white flex flex-col justify-center items-center">
          
          {!isPlaying && currentDisplayLayer && (
            <div className="absolute top-3 left-3 sm:top-6 sm:left-6 z-20 flex gap-2">
              <button
                onClick={() => {
                  setEditingLayerId(currentDisplayLayer.id);
                  setImageToCrop(currentDisplayLayer.imageUrl);
                }}
                className="bg-white/95 hover:bg-brand-surface border border-brand-accent/20 hover:border-brand-accent transition-all px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-full text-[9px] sm:text-[10px] font-black uppercase tracking-widest shadow-md text-brand-accent flex items-center gap-1 sm:gap-1.5 cursor-pointer"
                title="Recalculate current layer's crop and alignment configuration"
              >
                <Crop className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-brand-accent animate-pulse" />
                <span>Recalculate Alignment</span>
              </button>
            </div>
          )}

          <div className="absolute inset-0 w-full h-full overflow-hidden bg-white flex items-center justify-center">
            {enableWebGPU ? (
              <canvas
                ref={webGPUCanvasRef}
                className="absolute inset-0 w-full h-full object-contain"
              />
            ) : layers.length > 0 ? (
              <div className="absolute inset-0 w-full h-full flex items-center justify-center">
                {layers.map((layer, idx) => {
                  const isCurrent = idx === currentDisplayIndex;
                  const isPrev = idx === prevDisplayIndex;
                  const isVisible = isCurrent || isPrev;

                  if (!isVisible) return null;

                  return (
                    <motion.img
                      key={layer.id}
                      src={layer.imageUrl}
                      alt="Painting Progress"
                      initial={isCurrent && transitionEffect === 'fade' ? { opacity: 0 } : { opacity: 1 }}
                      animate={{ opacity: isCurrent ? 1 : 0 }}
                      style={{ zIndex: isCurrent ? 10 : 0 }}
                      transition={
                        transitionEffect === 'fade'
                          ? { duration: Math.min((frameDelay / 1000) * 0.75, 0.45), ease: "linear" }
                          : { duration: 0 }
                      }
                      className="absolute inset-0 w-full h-full object-contain"
                      referrerPolicy="no-referrer"
                    />
                  );
                })}
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-brand-muted bg-white">
                No Layers Yet
              </div>
            )}
          </div>
          
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none"></div>
          
          <div className="absolute bottom-4 left-4 sm:bottom-8 sm:left-8 text-white z-10 drop-shadow-xl p-2.5 sm:p-4 rounded-lg bg-black/20 backdrop-blur-sm max-w-[85%] sm:max-w-[70%]">
             <span className="text-[9px] sm:text-[10px] uppercase tracking-widest opacity-90 mb-0.5 sm:mb-1 block font-bold text-white/90">
               {isPlaying ? "Timelapse Preview Active" : "Selected Progress Milestone"}
             </span>
             <h2 className="text-xl sm:text-4xl font-serif italic text-white leading-tight">{artwork.title}</h2>
          </div>

          <div className="absolute top-3 right-3 sm:top-6 sm:right-6 flex flex-col gap-1 sm:gap-2 z-10">
            <div className="bg-white/95 backdrop-blur px-3 sm:px-4 py-1 sm:py-1.5 rounded-full text-[9px] sm:text-[10px] font-bold uppercase tracking-tighter shadow-sm border border-black/5 text-brand-text flex items-center gap-1.5 sm:gap-2">
               {isPlaying && playbackIndex !== null 
                 ? `Timelapse: ${playbackIndex + 1}/${layers.length}` 
                 : `Layer ${(currentLayerIndex !== -1 ? currentLayerIndex : layers.length - 1) + 1}`}
               <span className={`w-1.5 h-1.5 rounded-full inline-block ${isPlaying ? 'bg-brand-accent animate-ping' : 'bg-brand-accent'}`}></span>
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
                  onClick={() => setIsPlaying(!isPlaying)}
                  className={`px-3 sm:px-5 py-2 sm:py-2.5 text-[9px] sm:text-[10px] uppercase tracking-widest font-bold rounded-full shadow-xl transition-all flex items-center gap-1.5 sm:gap-2 border ${isPlaying ? 'bg-brand-accent text-white border-brand-accent hover:scale-105' : 'bg-white text-brand-text border-black/10 hover:bg-brand-surface hover:scale-105'}`}
                >
                  {isPlaying ? <span className="w-1.5 h-1.5 bg-white rounded-full animate-ping mr-1" /> : <Play className="w-2.5 sm:w-3 h-2.5 sm:h-3 fill-current" />}
                  {isPlaying ? 'Pause' : 'Play'}
                </button>
             )}
             <button 
                onClick={generateTimelapse}
                disabled={layers.length < 2 || generating}
                className="px-3 sm:px-5 py-2 sm:py-2.5 bg-brand-text text-white text-[9px] sm:text-[10px] uppercase tracking-widest font-bold rounded-full shadow-xl hover:bg-black hover:scale-105 transition-all disabled:opacity-50 disabled:hover:scale-100 flex items-center gap-1.5 sm:gap-2 border border-white/20"
              >
                {generating ? <Loader2 className="w-3.5 sm:w-4 h-3.5 sm:h-4 animate-spin" /> : <Download className="w-3.5 sm:w-4 h-3.5 sm:h-4" />}
                <span className="hidden sm:inline">
                  {layers.length < 2 ? "Upload 2+ layers to Export" : "Export Video"}
                </span>
                <span className="inline sm:hidden">
                  Export
                </span>
              </button>
          </div>

        </div>
      </section>

      <aside className="w-full md:w-80 lg:w-96 border-t md:border-t-0 md:border-l border-brand-border bg-white flex flex-col h-auto md:h-full overflow-visible md:overflow-hidden">
        {/* Google Stitch Pill Tabs */}
        <div className="p-4 border-b border-brand-border bg-white">
          <div className="flex bg-brand-surface p-1 rounded-full border border-brand-border">
            <button
              onClick={() => setActiveTab('milestones')}
              className={`flex-1 py-2 text-center text-[10px] uppercase tracking-wider font-extrabold transition-all rounded-full flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === 'milestones'
                  ? 'bg-brand-text text-white shadow-md'
                  : 'text-brand-muted hover:text-brand-text'
              }`}
            >
              <LayersIcon className="w-3.5 h-3.5" />
              Milestones ({layers.length})
            </button>
            <button
              onClick={() => setActiveTab('timelapse')}
              className={`flex-1 py-2 text-center text-[10px] uppercase tracking-wider font-extrabold transition-all rounded-full flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === 'timelapse'
                  ? 'bg-brand-accent text-white shadow-md'
                  : 'text-brand-muted hover:text-brand-accent animate-pulse'
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              Timelapse Studio
            </button>
          </div>
        </div>

        {/* Content Panel */}
        <div className="flex-1 overflow-y-visible md:overflow-y-auto flex flex-col">
          {activeTab === 'milestones' ? (
            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="flex items-center justify-between border-b border-brand-border px-6 py-4 bg-brand-surface/30">
                <div>
                  <h3 className="text-xs uppercase tracking-[0.2em] font-bold text-brand-text">Progress History</h3>
                  <p className="text-[10px] text-brand-muted mt-0.5">{layers.length} milestone{layers.length !== 1 ? 's' : ''} uploaded</p>
                </div>
                
                {confirmDelete ? (
                  <div className="flex items-center gap-1.5 z-10">
                    <button
                      onClick={handleDeleteArtwork}
                      className="px-2.5 py-1 bg-red-600 text-white text-[9px] uppercase tracking-widest font-bold rounded hover:bg-red-700 transition-all shadow-sm"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="px-2 py-1 bg-gray-150 text-brand-text text-[9px] uppercase tracking-widest font-bold rounded hover:bg-gray-200 transition-colors border border-black/5"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="p-1 px-3 text-[10px] text-red-600 border border-red-200 rounded-full hover:bg-red-50 flex items-center gap-1.5 transition-colors font-semibold uppercase tracking-wider"
                    title="Delete project"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                )}
              </div>

              <div className="flex-1 p-6 space-y-4 overflow-y-visible md:overflow-y-auto">
                <p className="text-[10px] text-brand-muted leading-relaxed mb-4 p-3 bg-brand-surface rounded-lg border border-brand-border/40 italic">
                  ✨ <strong>Paint Frame Precision Alignment:</strong> Crop milestones in the exact same proportion and place them in the center of the guidelines so progress steps stay perfectly calibrated.
                </p>

                <div 
                  {...getRootProps()} 
                  className={`sticky top-0 bg-brand-surface border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-300 mb-6 z-10 flex flex-col items-center justify-center gap-3
                  ${isDragActive ? 'border-brand-accent bg-white/80' : 'border-brand-border hover:border-brand-accent/50'} 
                  ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  <input {...getInputProps()} />
                  <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-brand-accent shadow-sm">
                     {uploading ? <Loader2 className="w-5 h-5 animate-spin text-brand-accent" /> : <ImagePlus className="w-5 h-5 text-brand-accent" />}
                  </div>
                  <div className="text-[10px] uppercase tracking-widest font-bold text-brand-text">Drop new progress layer</div>
                </div>

                {layers.map((layer, index) => {
                   const isCurrentlyDisplayed = playbackIndex !== null 
                     ? playbackIndex === index
                     : (selectedLayerId !== null ? selectedLayerId === layer.id : index === layers.length - 1);
                   return (
                     <div 
                       key={layer.id} 
                       onClick={() => {
                         setIsPlaying(false);
                         setSelectedLayerId(layer.id);
                       }}
                       className={`group relative flex gap-3 items-center p-3 rounded-xl cursor-pointer transition-all border ${
                         isCurrentlyDisplayed 
                           ? 'bg-brand-surface border-brand-accent shadow-sm' 
                           : 'bg-white border-brand-border hover:border-brand-accent/30 hover:bg-brand-surface/20'
                       }`}
                     >
                        {/* Thumbnail */}
                        <div className="w-12 h-12 bg-brand-surface rounded-lg overflow-hidden flex-shrink-0 border border-brand-border relative">
                           <img src={layer.imageUrl} alt={`Layer ${index + 1}`} className="w-full h-full object-cover" />
                           <div className="absolute top-0.5 left-0.5 bg-black/75 text-white font-mono text-[8px] px-1 rounded uppercase tracking-tighter">
                             L{index + 1}
                           </div>
                        </div>

                        {/* Mid Meta */}
                        <div className="flex-1 min-w-0 pr-16">
                           <div className="flex items-center gap-1.5">
                             <p className="text-[10px] font-extrabold uppercase text-brand-text truncate">
                               {index === 0 ? "1. Baseline" : `${index + 1}. Milestone`}
                             </p>
                             {isCurrentlyDisplayed && (
                               <span className="w-1.5 h-1.5 rounded-full bg-brand-accent" />
                             )}
                           </div>
                           <p className="text-[9px] text-brand-muted font-bold font-mono mt-0.5 tracking-wider">
                             {format(new Date(layer.createdAt), 'MMM d, h:mm a')}
                           </p>
                        </div>

                        {/* Quick Control Layer Actions (Stitch Rounded Icon Pills) - Always visible for iframe preview reliability and easy alignment */}
                        <div className="absolute right-2 flex items-center bg-white/95 backdrop-blur rounded-full p-0.5 shadow-sm border border-brand-border transition-all duration-150 z-20">
                           <button
                             disabled={index === 0}
                             onClick={(e) => {
                               e.stopPropagation();
                               handleMoveLayer(index, 'up');
                             }}
                             className={`p-1 rounded-full ${index === 0 ? 'text-gray-300 cursor-not-allowed opacity-30' : 'text-brand-text hover:bg-brand-surface hover:text-brand-accent'}`}
                             title="Move Up Timeline"
                           >
                             <ArrowLeft className="w-3.5 h-3.5 rotate-90" />
                           </button>
                           
                           <button
                             disabled={index === layers.length - 1}
                             onClick={(e) => {
                               e.stopPropagation();
                               handleMoveLayer(index, 'down');
                             }}
                             className={`p-1 rounded-full ${index === layers.length - 1 ? 'text-gray-300 cursor-not-allowed opacity-30' : 'text-brand-text hover:bg-brand-surface hover:text-brand-accent'}`}
                             title="Move Down Timeline"
                           >
                             <ArrowLeft className="w-3.5 h-3.5 -rotate-90" />
                           </button>

                           <button
                             onClick={(e) => {
                               e.stopPropagation();
                               setIsPlaying(false);
                               setEditingLayerId(layer.id);
                               setImageToCrop(layer.imageUrl);
                             }}
                             className="p-1 rounded-full text-brand-text hover:bg-brand-surface hover:text-brand-accent"
                             title="Recalculate Alignment & Crop"
                           >
                             <Crop className="w-3.5 h-3.5 text-brand-accent" />
                           </button>

                           <button
                             onClick={(e) => {
                               e.stopPropagation();
                               setDeletingLayerId(layer.id);
                             }}
                             className="p-1 rounded-full text-red-500 hover:bg-red-50 hover:text-red-700 transition"
                             title="Delete Layer"
                           >
                             <Trash2 className="w-3.5 h-3.5" />
                           </button>
                        </div>

                        {deletingLayerId === layer.id && (
                          <div className="absolute inset-0 bg-white/98 z-30 flex items-center justify-between px-4 rounded-xl border border-red-200">
                            <span className="text-[10px] font-black uppercase tracking-wider text-red-600">Delete milestone?</span>
                            <div className="flex gap-1.5">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteLayer(layer.id, layer.imageUrl);
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
                    <div className="text-center py-8 text-brand-muted text-[10px] uppercase tracking-wider font-bold">No layering history available</div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-6 space-y-6">
              {/* Timelapse config section */}
              <div className="space-y-2">
                <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-brand-accent block">Studio Dashboard</span>
                <h3 className="font-serif italic text-2xl font-bold">Timelapse Controls</h3>
                <p className="text-[11px] text-brand-muted leading-relaxed">Customize your paint-progression movie, test frame-by-frame steps, and export in High Definition.</p>
              </div>

              {/* Playback Controls Box */}
              <div className="bg-brand-surface rounded-xl p-5 border border-brand-border/40 space-y-4 shadow-sm text-center">
                <span className="text-[9px] uppercase tracking-widest font-black text-brand-muted block">
                  {isPlaying ? "🔄 Continuous Loop Active" : "⏸️ Stopped on Milestone"}
                </span>

                <div className="text-3xl font-serif italic text-brand-text mb-2 font-bold">
                  {isPlaying && playbackIndex !== null 
                    ? `Frame ${playbackIndex + 1} / ${layers.length}` 
                    : `Frame ${(currentLayerIndex !== -1 ? currentLayerIndex : layers.length - 1) + 1} / ${layers.length}`}
                </div>

                <div className="flex items-center justify-center gap-4">
                  <button 
                    onClick={stepBackward}
                    className="p-2.5 rounded-full bg-white hover:bg-brand-surface border border-black/5 text-brand-text shadow-sm transition-transform hover:scale-115 active:scale-95 animate-none"
                    title="Previous Frame"
                    disabled={layers.length < 1}
                  >
                    <SkipBack className="w-4 h-4 fill-current text-brand-text" />
                  </button>

                  <button 
                    onClick={() => setIsPlaying(!isPlaying)}
                    className={`w-12 h-12 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-md ${
                      isPlaying 
                        ? 'bg-brand-accent text-white hover:bg-brand-accent/95 cursor-pointer' 
                        : 'bg-brand-text text-white hover:bg-black cursor-pointer'
                    }`}
                    title={isPlaying ? "Pause Playback" : "Play Timelapse"}
                    disabled={layers.length < 2}
                  >
                    {isPlaying ? (
                      <span className="flex gap-1 items-center justify-center">
                        <span className="w-1.5 h-4 bg-white rounded-full"></span>
                        <span className="w-1.5 h-4 bg-white rounded-full"></span>
                      </span>
                    ) : (
                      <Play className="w-4 h-4 text-white fill-current ml-0.5" />
                    )}
                  </button>

                  <button 
                    onClick={stepForward}
                    className="p-2.5 rounded-full bg-white hover:bg-brand-surface border border-black/5 text-brand-text shadow-sm transition-transform hover:scale-115 active:scale-95 animate-none"
                    title="Next Frame"
                    disabled={layers.length < 1}
                  >
                    <SkipForward className="w-4 h-4 fill-current text-brand-text" />
                  </button>
                </div>

                {layers.length < 2 && (
                  <p className="text-[10px] text-red-500 font-semibold mt-2">
                    ⚠️ Upload at least 2 layers to enable playback!
                  </p>
                )}

                {!isPlaying && currentDisplayLayer && (
                  <button
                    onClick={() => {
                      setEditingLayerId(currentDisplayLayer.id);
                      setImageToCrop(currentDisplayLayer.imageUrl);
                    }}
                    className="mt-3 w-full py-2.5 bg-white hover:bg-brand-surface border border-brand-accent/30 hover:border-brand-accent text-brand-accent transition-all rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                    title="Recalculate alignment and crop bounds for the current frame"
                  >
                    <Crop className="w-3.5 h-3.5 text-brand-accent animate-pulse" />
                    <span>Recalculate Alignment</span>
                  </button>
                )}
              </div>

              {/* Frame Speed / Delay Hold */}
              <div className="space-y-2.5">
                <label className="text-[10px] uppercase tracking-widest font-black text-brand-text flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-brand-accent" />
                  Frame Hold Speed
                </label>
                <div className="grid grid-cols-4 gap-1 bg-brand-surface p-1 rounded-lg border border-brand-border/40">
                  {[
                    { label: "0.2s", val: 200 },
                    { label: "0.5s", val: 500 },
                    { label: "1.0s", val: 1000 },
                    { label: "1.5s", val: 1500 }
                  ].map((preset) => (
                    <button
                      key={preset.val}
                      onClick={() => setFrameDelay(preset.val)}
                      className={`py-1.5 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                        frameDelay === preset.val 
                          ? 'bg-brand-text text-white shadow-sm font-black'
                          : 'text-brand-muted hover:text-brand-text'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Transition Style Selection */}
              <div className="space-y-2.5">
                <label className="text-[10px] uppercase tracking-widest font-black text-brand-text flex items-center gap-1.5">
                  <Film className="w-3.5 h-3.5 text-brand-accent" />
                  Transition Animation
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => setTransitionEffect('fade')}
                    className={`py-2 px-3 text-[10px] uppercase tracking-widest font-bold border rounded-lg text-center transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      transitionEffect === 'fade'
                        ? 'border-brand-accent text-brand-accent bg-brand-accent/5 font-black'
                        : 'border-brand-border/60 text-brand-muted hover:text-brand-text'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Dissolve
                  </button>
                  <button
                    onClick={() => setTransitionEffect('cut')}
                    className={`py-2 px-3 text-[10px] uppercase tracking-widest font-bold border rounded-lg text-center transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      transitionEffect === 'cut'
                        ? 'border-brand-text text-brand-text bg-brand-surface font-black'
                        : 'border-brand-border/60 text-brand-muted hover:text-brand-text'
                    }`}
                  >
                    <X className="w-3.5 h-3.5" />
                    Instant Cut
                  </button>
                </div>
              </div>

              {/* Continuous Loop Toggle */}
              <div className="flex items-center justify-between p-3.5 bg-brand-surface rounded-xl border border-brand-border/40">
                <div className="space-y-0.5">
                  <span className="text-[10px] uppercase tracking-wider font-extrabold text-brand-text block">Continuous Loop</span>
                  <span className="text-[9px] text-brand-muted block">Loop the timelapse indefinitely</span>
                </div>
                <button
                  onClick={() => setLoopMode(!loopMode)}
                  className={`w-10 h-6 rounded-full transition-colors flex items-center p-0.5 cursor-pointer ${loopMode ? 'bg-brand-accent' : 'bg-gray-200'}`}
                >
                  <span className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${loopMode ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* WebGPU Hardware Acceleration Block */}
              <div className="bg-brand-surface rounded-xl p-4 border border-brand-border/40 space-y-3.5">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <span className="text-[10px] uppercase tracking-wider font-extrabold text-brand-text flex items-center gap-1.5 font-sans">
                      <Sparkles className="w-3.5 h-3.5 text-brand-accent animate-pulse" />
                      GPU Acceleration (WebGPU)
                    </span>
                    <span className="text-[9px] text-brand-muted block">Direct GPU rendering passes</span>
                  </div>
                  <button
                    onClick={() => setEnableWebGPU(!enableWebGPU)}
                    className={`w-10 h-6 rounded-full transition-colors flex items-center p-0.5 cursor-pointer ${enableWebGPU ? 'bg-brand-accent' : 'bg-gray-200'}`}
                  >
                    <span className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${enableWebGPU ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                </div>

                {enableWebGPU && (
                  <div className="space-y-3 pt-2 border-t border-brand-border/40">
                    <div className="space-y-1">
                      <span className="text-[9px] uppercase font-bold text-brand-muted flex justify-between font-sans">
                        <span>Brightness Adjustment</span>
                        <span className="font-mono text-brand-text font-black">{webGPUBrightness.toFixed(1)}x</span>
                      </span>
                      <input
                        type="range"
                        min="0.5"
                        max="2.0"
                        step="0.1"
                        value={webGPUBrightness}
                        onChange={(e) => setWebGPUBrightness(parseFloat(e.target.value))}
                        className="w-full accent-brand-accent cursor-pointer h-1 bg-gray-200 rounded-lg appearance-none"
                      />
                    </div>
                    
                    <div className="space-y-1">
                      <span className="text-[9px] uppercase font-bold text-brand-muted flex justify-between font-sans">
                        <span>Contrast Optimizer</span>
                        <span className="font-mono text-brand-text font-black">{webGPUContrast.toFixed(1)}x</span>
                      </span>
                      <input
                        type="range"
                        min="0.5"
                        max="2.0"
                        step="0.1"
                        value={webGPUContrast}
                        onChange={(e) => setWebGPUContrast(parseFloat(e.target.value))}
                        className="w-full accent-brand-accent cursor-pointer h-1 bg-gray-200 rounded-lg appearance-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <span className="text-[9px] uppercase font-bold text-brand-muted flex justify-between font-sans">
                        <span>Absolute Saturation</span>
                        <span className="font-mono text-brand-text font-black">{webGPUSaturation.toFixed(1)}x</span>
                      </span>
                      <input
                        type="range"
                        min="0.0"
                        max="2.0"
                        step="0.1"
                        value={webGPUSaturation}
                        onChange={(e) => setWebGPUSaturation(parseFloat(e.target.value))}
                        className="w-full accent-brand-accent cursor-pointer h-1 bg-gray-200 rounded-lg appearance-none"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Technical Specifications */}
              <div className="p-4 bg-brand-surface/40 rounded-xl border border-brand-border/20 space-y-2 text-[10px] font-mono text-brand-muted">
                <div className="flex justify-between">
                  <span>FORMAT</span>
                  <span className="font-extrabold text-brand-text">WebM (VP9 Codec)</span>
                </div>
                <div className="flex justify-between">
                  <span>RESOLUTIONS</span>
                  <span className="font-extrabold text-brand-text">Adaptive High-Res</span>
                </div>
                <div className="flex justify-between">
                  <span>FRAMERATE</span>
                  <span className="font-extrabold text-brand-text">30 Frames/Sec</span>
                </div>
                <div className="flex justify-between">
                  <span>TOTAL FRAMES</span>
                  <span className="font-extrabold text-brand-text">{layers.length} milestone{layers.length !== 1 ? 's' : ''}</span>
                </div>
              </div>

              {/* Sidebar Prime Export Button Option */}
              <button
                onClick={generateTimelapse}
                disabled={layers.length < 2 || generating}
                className="w-full py-4.5 bg-brand-accent text-white text-[11px] uppercase tracking-[0.2em] font-black rounded-xl shadow-xl hover:bg-brand-accent hover:opacity-95 hover:scale-[1.02] transition-all disabled:opacity-40 disabled:hover:scale-100 flex items-center justify-center gap-2 border border-brand-accent cursor-pointer"
              >
                {generating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Processing Movie...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>EXPORT TIMELAPSE VIDEO</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Modern Cropping Modal Overlay */}
      {imageToCrop && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col my-auto max-h-[96vh] sm:max-h-[90vh]">
            <div className="px-5 py-3.5 border-b border-brand-border flex items-center justify-between bg-brand-surface/30">
              <div>
                <h3 className="text-xs sm:text-sm uppercase tracking-widest font-black text-brand-text">Frame Precision alignment</h3>
                <p className="text-[10px] text-brand-muted mt-0.5">
                  {editingLayerId ? "Editing existing milestone selection" : `File ${pendingFileIndex + 1} of ${pendingFiles.length} — ${pendingFiles[pendingFileIndex]?.name}`}
                </p>
              </div>
              <button 
                onClick={handleCancelCrop}
                className="p-1 px-3 text-[10px] text-brand-muted border border-brand-border hover:border-brand-text hover:text-brand-text transition-all rounded-full font-bold uppercase tracking-wider cursor-pointer"
              >
                Cancel
              </button>
            </div>

            {/* Elegant Mode Toggle */}
            <div className="px-5 py-2.5 border-b border-brand-border bg-brand-surface/20 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 flex-shrink-0">
              <span className="text-[10px] uppercase tracking-widest font-black text-brand-muted">Crop / Alignment Mode</span>
              <div className="flex gap-1 p-0.5 bg-brand-surface rounded-full border border-brand-border self-end sm:self-auto">
                <button
                  type="button"
                  onClick={() => setCropMode('standard')}
                  className={`px-3 py-1 text-[9px] font-black uppercase rounded-full transition-all cursor-pointer ${
                    cropMode === 'standard'
                      ? 'bg-brand-text text-white shadow'
                      : 'text-brand-muted hover:text-brand-text'
                  }`}
                >
                  Classic Crop
                </button>
                <button
                  type="button"
                  onClick={() => setCropMode('perspective')}
                  className={`px-3 py-1 text-[9px] font-black uppercase rounded-full transition-all cursor-pointer ${
                    cropMode === 'perspective'
                      ? 'bg-brand-text text-white shadow'
                      : 'text-brand-muted hover:text-brand-text'
                  }`}
                >
                  📐 Perspective de-slant
                </button>
              </div>
            </div>

            {/* Cropper viewport box - generous viewport height for perfect portrait and landscape framing */}
            <div className="relative h-[38vh] sm:h-[48vh] min-h-[260px] bg-neutral-950 border-b border-brand-border flex-shrink-0 flex items-center justify-center overflow-hidden">
              {cropMode === 'standard' ? (
                <>
                  <Cropper
                    image={imageToCrop}
                    crop={crop}
                    zoom={zoom}
                    aspect={aspectRatio}
                    onCropChange={setCrop}
                    onZoomChange={setZoom}
                    onCropComplete={onCropComplete}
                    showGrid={true}
                  />
                  
                  {/* High-visibility Canvas Center/Centering Guides (without visual-blocking layout masks) */}
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="border border-brand-accent/25 rounded-lg w-[85%] h-[85%] flex items-center justify-center">
                      <div className="border border-brand-accent/15 w-1/3 h-1/3 border-dashed rounded flex items-center justify-center">
                        <span className="w-1.5 h-1.5 rounded-full bg-brand-accent/30" />
                      </div>
                    </div>
                    <div className="absolute bottom-3 left-4 right-4 text-center">
                      <span className="bg-black/85 px-2.5 py-1 text-[8.5px] uppercase tracking-widest font-extrabold text-brand-accent rounded-full border border-brand-accent/20 backdrop-blur-sm">
                        🎯 POSITION ARTWORK MARGINS WITHIN CROSSHAIRS
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                /* Perspective quad/homography warp selector */
                <div 
                  className="relative w-full h-full flex items-center justify-center select-none animate-fade-in"
                  onMouseMove={handleDragMove}
                  onTouchMove={handleDragMove}
                  onMouseUp={handleEndDrag}
                  onTouchEnd={handleEndDrag}
                  onMouseLeave={handleEndDrag}
                >
                  <img
                    ref={imgRef}
                    src={imageToCrop}
                    className="max-w-[78%] max-h-[78%] object-contain pointer-events-none select-none transition-all duration-300"
                    onLoad={updateContainerDimensions}
                    referrerPolicy="no-referrer"
                  />
                  
                  {containerSize.width > 0 && (
                    <svg
                      className="absolute overflow-visible pointer-events-auto"
                      style={{
                        width: containerSize.width,
                        height: containerSize.height,
                        left: containerSize.left,
                        top: containerSize.top,
                      }}
                    >
                      {/* Translucent quadrilateral overlay with clean cyan coloring */}
                      <polygon
                        points={perspectivePoints.map(p => `${p.x * containerSize.width},${p.y * containerSize.height}`).join(' ')}
                        fill="rgba(14, 165, 233, 0.2)"
                        stroke="#0ea5e9"
                        strokeWidth="2.5"
                        strokeLinejoin="round"
                      />

                      {/* Line guides between diagonal corners to help centering */}
                      <line
                        x1={perspectivePoints[0].x * containerSize.width}
                        y1={perspectivePoints[0].y * containerSize.height}
                        x2={perspectivePoints[2].x * containerSize.width}
                        y2={perspectivePoints[2].y * containerSize.height}
                        stroke="rgba(14, 165, 233, 0.15)"
                        strokeWidth="1"
                        strokeDasharray="3 3"
                      />
                      <line
                        x1={perspectivePoints[1].x * containerSize.width}
                        y1={perspectivePoints[1].y * containerSize.height}
                        x2={perspectivePoints[3].x * containerSize.width}
                        y2={perspectivePoints[3].y * containerSize.height}
                        stroke="rgba(14, 165, 233, 0.15)"
                        strokeWidth="1"
                        strokeDasharray="3 3"
                      />
                      
                      {/* Interactive Drag Handles */}
                      {perspectivePoints.map((p, idx) => {
                        const cx = p.x * containerSize.width;
                        const cy = p.y * containerSize.height;
                        return (
                          <g key={idx}>
                            {/* Larger invisible touch target */}
                            <circle
                              cx={cx}
                              cy={cy}
                              r="20"
                              fill="transparent"
                              className="cursor-move"
                              onMouseDown={(e) => { e.preventDefault(); setActivePointIndex(idx); }}
                              onTouchStart={(e) => { e.preventDefault(); setActivePointIndex(idx); }}
                            />
                            {/* Visual Handle Ring */}
                            <circle
                              cx={cx}
                              cy={cy}
                              r="10"
                              fill="#ffffff"
                              stroke="#0ea5e9"
                              strokeWidth="3.5"
                              className={`pointer-events-none transition-transform ${activePointIndex === idx ? 'scale-125' : 'hover:scale-110'}`}
                              style={{ filter: "drop-shadow(0px 3px 6px rgba(0,0,0,0.4))" }}
                            />
                            {/* Short Corner Label */}
                            <text
                              x={cx}
                              y={cy + 3}
                              textAnchor="middle"
                              fontSize="8"
                              fontWeight="900"
                              fill="#0ea5e9"
                              className="pointer-events-none select-none font-sans"
                            >
                              {idx === 0 ? "TL" : idx === 1 ? "TR" : idx === 2 ? "BR" : "BL"}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  )}

                  <div className="absolute top-2.5 left-2.5 px-3 py-1 rounded-full bg-black/75 backdrop-blur border border-white/10 text-white font-extrabold uppercase tracking-widest text-[8px] pointer-events-none">
                    📐 QUAD PERSPECTIVE TRANSFORM MODE
                  </div>

                  <div className="absolute bottom-3 left-4 right-4 text-center pointer-events-none">
                    <span className="bg-[#0ea5e9] text-white px-2.5 py-1 text-[8.5px] uppercase tracking-widest font-extrabold rounded-full border border-sky-400/20 backdrop-blur-sm shadow-md">
                      Drag the 4 handles to match the painting's corners
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Scrollable Options panel */}
            <div className="p-4 bg-brand-surface/30 border-t border-brand-border space-y-3 overflow-y-auto max-h-[22vh] sm:max-h-[28vh]">
              {cropMode === 'standard' ? (
                <>
                  {/* Enforced Fixed Ratio Selection Grid */}
                  <div className="space-y-1.5">
                    <span className="text-[9px] uppercase tracking-widest font-black text-brand-muted block">
                      Enforced Canvas Format (Align all milestones uniformly)
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-brand-surface rounded-xl border border-brand-border">
                      {[
                        { name: 'Original Ratio', ratio: originalAspect },
                        { name: 'Freeform', ratio: undefined },
                        { name: '1:1 Square', ratio: 1 },
                        { name: '3:4 Portrait', ratio: 3 / 4 },
                        { name: '4:3 Classic', ratio: 4 / 3 },
                        { name: '9:16 Vertical', ratio: 9 / 16 },
                        { name: '16:9 Wide', ratio: 16 / 9 },
                      ].map((opt) => (
                        <button
                          key={opt.name}
                          type="button"
                          onClick={() => setAspectRatio(opt.ratio)}
                          className={`py-1 text-[9px] font-extrabold uppercase rounded-lg transition-all cursor-pointer text-center ${
                            (aspectRatio === opt.ratio || (opt.name === 'Original Ratio' && aspectRatio && originalAspect && Math.abs(aspectRatio - originalAspect) < 0.001))
                              ? 'bg-brand-text text-white shadow'
                              : 'text-brand-muted hover:text-brand-text hover:bg-black/5'
                          }`}
                        >
                          {opt.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 py-0.5">
                    <span className="text-[10px] uppercase tracking-widest font-black text-brand-text">Zoom</span>
                    <input
                      type="range"
                      min={1}
                      max={3}
                      step={0.1}
                      value={zoom}
                      onChange={(e) => setZoom(Number(e.target.value))}
                      className="flex-1 accent-brand-accent cursor-pointer h-1.5 bg-brand-border rounded-lg"
                    />
                    <span className="text-xs font-mono font-bold w-10 text-right">{Math.round(zoom * 100)}%</span>
                  </div>
                </>
              ) : (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-2 bg-brand-surface rounded-xl border border-brand-border">
                  <div className="text-left animate-fade-in">
                    <span className="text-[9px] uppercase tracking-widest font-black text-[#0ea5e9] block">
                      📐 HOMOGRAPHIC WARPING CONTROLS
                    </span>
                    <span className="text-[10px] text-brand-muted block mt-0.5">
                      Compensates camera tilts. Restores true rectangular painting coordinates.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPerspectivePoints([
                        { x: 0.15, y: 0.15 },
                        { x: 0.85, y: 0.15 },
                        { x: 0.85, y: 0.85 },
                        { x: 0.15, y: 0.85 }
                      ]);
                      toast.success("Corners reset to 15% inner boundaries.");
                    }}
                    className="w-full sm:w-auto px-4 py-1.5 bg-brand-surface hover:bg-black/5 border border-brand-border text-brand-text text-[9px] font-bold uppercase tracking-wider rounded-lg transition-all cursor-pointer"
                  >
                    Reset Grid
                  </button>
                </div>
              )}

              {/* Advanced Auto-Alignment Feature Toggle */}
              <div className="flex flex-col gap-1.5 mt-1">
                <div className="flex items-center justify-between p-2.5 bg-brand-surface rounded-xl border border-brand-border">
                  <div className="flex items-center gap-2">
                    <input
                      id="auto-align-toggle"
                      type="checkbox"
                      checked={autoAlignEnabled}
                      onChange={(e) => setAutoAlignEnabled(e.target.checked)}
                      className="w-4 h-4 rounded border-brand-border text-brand-accent focus:ring-brand-accent cursor-pointer accent-brand-accent"
                    />
                    <label htmlFor="auto-align-toggle" className="text-[10px] font-black uppercase tracking-widest text-brand-text cursor-pointer select-none">
                      High-Precision Auto-Align with past milestones
                    </label>
                  </div>
                  <span className="text-[9px] text-brand-muted hidden sm:inline">
                    Restores alignment & angle automatically
                  </span>
                </div>

                <div className="flex items-center justify-between p-2.5 bg-brand-surface rounded-xl border border-brand-border">
                  <div className="flex items-center gap-2">
                    <input
                      id="snap-to-edge-toggle"
                      type="checkbox"
                      checked={snapToEdgesEnabled}
                      onChange={(e) => setSnapToEdgesEnabled(e.target.checked)}
                      className="w-4 h-4 rounded border-brand-border text-brand-accent focus:ring-brand-accent cursor-pointer accent-brand-accent"
                    />
                    <label htmlFor="snap-to-edge-toggle" className="text-[10px] font-black uppercase tracking-widest text-brand-text cursor-pointer select-none">
                      🧲 Magnetic Snapping to artwork edges
                    </label>
                  </div>
                  <span className="text-[9px] text-brand-muted hidden sm:inline">
                    Seeks and locks high-contrast canvas borders
                  </span>
                </div>
              </div>
            </div>

            {/* Permanently Sticky Actions Footer - guarantees buttons have priority and are ALWAYS visible in small iframe screens */}
            <div className="p-4 bg-white border-t border-brand-border flex flex-wrap md:flex-nowrap gap-2.5 flex-shrink-0">
              <button
                type="button"
                onClick={() => handleAIDetectBounds(undefined, 'opencv')}
                disabled={detectingBounds || uploading}
                className="flex-1 md:flex-none px-3.5 py-2.5 bg-brand-surface border border-brand-accent/20 text-brand-text hover:bg-brand-surface/70 hover:border-brand-accent/40 transition-all rounded-lg text-[10px] uppercase font-black tracking-wider flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {detectingBounds ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-accent" />
                    <span>Detecting...</span>
                  </>
                ) : (
                  <>
                    <Crop className="w-3.5 h-3.5 text-brand-accent" />
                    <span>Auto-Detect (CV)</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleAIDetectBounds(undefined, 'gemini')}
                disabled={detectingBounds || uploading}
                className="flex-1 md:flex-none px-3.5 py-2.5 bg-brand-surface border border-brand-accent/15 text-brand-text hover:bg-brand-surface/70 hover:border-brand-accent/30 transition-all rounded-lg text-[10px] uppercase font-black tracking-wider flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                <span>AI Align (Gemini)</span>
              </button>

              <button
                onClick={handleCropConfirm}
                disabled={uploading || detectingBounds}
                className="w-full md:flex-1 py-2.5 sm:py-3 bg-brand-accent text-white text-[11px] uppercase tracking-wider font-extrabold rounded-lg hover:opacity-95 transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-55"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Processing & Uploading...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>{editingLayerId ? "Confirm & Re-align Milestone" : "Confirm Crop & Upload"}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
