import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import multer from 'multer';
import { createCanvas, loadImage } from 'canvas';
import cv from '@techstark/opencv-js';
import fs from 'fs';
import dotenv from 'dotenv';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { GoogleGenAI, Type } from "@google/genai";
import firebaseConfig from './firebase-applet-config.json' with { type: "json" };

// 1. Explicitly load environment variables
dotenv.config();
if (fs.existsSync(path.join(process.cwd(), '.env.local'))) {
  dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });
}

// 2. Initialize Firebase Admin SDK for backend token verification
if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

// Authentication middleware to verify Firebase ID tokens
async function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization header' });
  }

  const idToken = authHeader.split('Bearer ')[1].trim();
  try {
    const decodedToken = await getAuth().verifyIdToken(idToken);
    (req as any).user = decodedToken;
    next();
  } catch (err: any) {
    return res.status(401).json({ error: `Unauthorized: ${err.message || 'Invalid Firebase token'}` });
  }
}

// Memory-only multer for secure, bounded in-memory image processing
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20 MB max file size
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

function ensureCVReady(): Promise<void> {
  return new Promise((resolve) => {
    if (cv && typeof cv.Mat === 'function') {
      resolve();
      return;
    }
    if (cv) {
      const originalOnRuntime = cv.onRuntimeInitialized;
      cv.onRuntimeInitialized = () => {
        if (originalOnRuntime) originalOnRuntime();
        resolve();
      };
      const interval = setInterval(() => {
        if (cv && typeof cv.Mat === 'function') {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    } else {
      resolve();
    }
  });
}

function processImageForCV(imgData: any, track: <T>(obj: T) => T, maxSize: number = 800) {
  let rawMat = track(new cv.Mat(imgData.height, imgData.width, cv.CV_8UC4));
  rawMat.data.set(imgData.data);
  
  let scale = 1;
  if (rawMat.cols > maxSize || rawMat.rows > maxSize) {
    scale = maxSize / Math.max(rawMat.cols, rawMat.rows);
  }
  
  let processMat = track(new cv.Mat());
  if (scale !== 1) {
    cv.resize(rawMat, processMat, new cv.Size(Math.round(rawMat.cols * scale), Math.round(rawMat.rows * scale)));
  } else {
    rawMat.copyTo(processMat);
  }
  
  let gray = track(new cv.Mat());
  cv.cvtColor(processMat, gray, cv.COLOR_RGBA2GRAY);
  
  return { rawMat, processMat, gray, scale };
}

async function detectCanvasBoundsOpenCV(buffer: Buffer): Promise<{ymin: number, xmin: number, ymax: number, xmax: number}> {
  await ensureCVReady();
  const img = await loadImage(buffer);
  
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const imgData = ctx.getImageData(0, 0, img.width, img.height);

  const disposables: any[] = [];
  const track = <T>(obj: T): T => {
    if (obj && typeof (obj as any).delete === 'function') {
      disposables.push(obj);
    }
    return obj;
  };

  try {
    const { processMat } = processImageForCV(imgData, track, 1000);
    const gray = track(new cv.Mat());
    cv.cvtColor(processMat, gray, cv.COLOR_RGBA2GRAY);
    
    const blurred = track(new cv.Mat());
    cv.blur(gray, blurred, new cv.Size(5, 5));

    const edges = track(new cv.Mat());
    cv.Canny(blurred, edges, 30, 100, 3);

    const contoursList = track(new cv.MatVector());
    const hierarchy = track(new cv.Mat());
    cv.findContours(edges, contoursList, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let maxArea = 0;
    let bestBox = { ymin: 0.05, xmin: 0.05, ymax: 0.95, xmax: 0.95 };

    for (let i = 0; i < contoursList.size(); ++i) {
      const contour = contoursList.get(i);
      const area = cv.contourArea(contour);
      if (area > maxArea) {
        const rect = cv.boundingRect(contour);
        if (rect.width > processMat.cols * 0.15 && rect.height > processMat.rows * 0.15) {
          maxArea = area;
          bestBox = {
            ymin: Math.max(0, rect.y / processMat.rows),
            xmin: Math.max(0, rect.x / processMat.cols),
            ymax: Math.min(1, (rect.y + rect.height) / processMat.rows),
            xmax: Math.min(1, (rect.x + rect.width) / processMat.cols)
          };
        }
      }
    }

    return bestBox;
  } finally {
    for (const dec of disposables) {
      try {
        if (dec && typeof dec.delete === 'function') {
          dec.delete();
        }
      } catch (e) {
        console.error("Failed to delete cv object in bounds detection:", e);
      }
    }
  }
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

  // Global CORS Middleware
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  app.use(express.json({ limit: "15mb" }));

  // AI & CV Bounding Box Auto-Detection Endpoint (Protected by Firebase Auth)
  app.post("/api/detect-canvas-bounds", requireAuth, (upload.single("file") as any), async (req: express.Request, res: express.Response) => {
    try {
      let imageBuffer: Buffer | null = null;
      let mimeType = "image/jpeg";

      if (req.file) {
        imageBuffer = req.file.buffer;
        mimeType = req.file.mimetype || "image/jpeg";
      } else if (req.body.image) {
        const imageStr = req.body.image as string;
        if (imageStr.startsWith("data:")) {
          const commaIdx = imageStr.indexOf(",");
          if (commaIdx !== -1) {
            const prefix = imageStr.substring(0, commaIdx);
            const base64Data = imageStr.substring(commaIdx + 1);
            imageBuffer = Buffer.from(base64Data, "base64");
            const mimeMatch = prefix.match(/data:([^;]+)/);
            if (mimeMatch) mimeType = mimeMatch[1];
          }
        }
      }

      if (!imageBuffer) {
        return res.status(400).json({ error: "No image file or data provided" });
      }

      const method = (req.body.method as string) || (req.query.method as string);

      if (method === "gemini") {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          return res.status(400).json({ error: "GEMINI_API_KEY is not configured on the server." });
        }

        const ai = new GoogleGenAI({
          apiKey: apiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            }
          }
        });

        const promptObj = {
          inlineData: {
            mimeType: mimeType,
            data: imageBuffer.toString("base64")
          }
        };

        const textPart = {
          text: "Analyze this image containing a painting. Locate the rectangular boundary of the physical painting canvas, cardboard, plate, or sheet of paper where the artwork is painted. Ignore any background details such as a wall, easel support structure, frame border outside the canvas, floor, or hands holding it. Return the bounding box containing only the core painting. Also calculate and return the canvas's center x-coordinate (centerX), center y-coordinate (centerY), width, and height, all as normalized values from 0.0 to 1.0."
        };

        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: { parts: [promptObj, textPart] },
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                ymin: { type: Type.NUMBER, description: "Normalized top edge y-coordinate of the painted canvas from 0.0 to 1.0" },
                xmin: { type: Type.NUMBER, description: "Normalized left edge x-coordinate of the painted canvas from 0.0 to 1.0" },
                ymax: { type: Type.NUMBER, description: "Normalized bottom edge y-coordinate of the painted canvas from 0.0 to 1.0" },
                xmax: { type: Type.NUMBER, description: "Normalized right edge x-coordinate of the painted canvas from 0.0 to 1.0" },
                centerX: { type: Type.NUMBER, description: "Normalized horizontal center (centerX) of the canvas, computed as (xmin + xmax) / 2" },
                centerY: { type: Type.NUMBER, description: "Normalized vertical center (centerY) of the canvas, computed as (ymin + ymax) / 2" },
                width: { type: Type.NUMBER, description: "Normalized width of the canvas, computed as xmax - xmin" },
                height: { type: Type.NUMBER, description: "Normalized height of the canvas, computed as ymax - ymin" }
              },
              required: ["ymin", "xmin", "ymax", "xmax", "centerX", "centerY", "width", "height"]
            }
          }
        });

        if (response.text) {
          const parsed = JSON.parse(response.text.trim());
          return res.json({ success: true, bounds: parsed, mode: "gemini" });
        }
        return res.status(500).json({ error: "Gemini did not return structured bounding box data." });
      }

      // OpenCV Computer Vision bounds detection
      const localBounds = await detectCanvasBoundsOpenCV(imageBuffer);
      const cvW = localBounds.xmax - localBounds.xmin;
      const cvH = localBounds.ymax - localBounds.ymin;
      const boundsWithCenterAndDimensions = {
        ...localBounds,
        centerX: localBounds.xmin + cvW / 2,
        centerY: localBounds.ymin + cvH / 2,
        width: cvW,
        height: cvH
      };
      return res.json({ success: true, bounds: boundsWithCenterAndDimensions, mode: "opencv" });
    } catch (err: any) {
      console.error("Detect bounds error:", err);
      return res.status(500).json({ error: err.message || "Failed to detect canvas bounds" });
    }
  });

  // Homographic Perspective Warp Endpoint (Protected by Firebase Auth)
  app.post("/api/perspective-warp", requireAuth, (upload.single("file") as any), async (req: express.Request, res: express.Response) => {
    const disposables: any[] = [];
    const track = <T>(obj: T): T => {
      if (obj && typeof (obj as any).delete === 'function') {
        disposables.push(obj);
      }
      return obj;
    };

    try {
      await ensureCVReady();
      const file = req.file;
      const pointsStr = req.body.points as string;

      if (!file) {
        return res.status(400).json({ error: "Missing image file." });
      }

      if (!pointsStr) {
        return res.status(400).json({ error: "Missing points coordinates." });
      }

      const points = JSON.parse(pointsStr) as { x: number; y: number }[];
      if (!Array.isArray(points) || points.length !== 4) {
        return res.status(400).json({ error: "Perspective warping requires exactly 4 points." });
      }

      const img = await loadImage(file.buffer);
      const width = img.width;
      const height = img.height;

      // Denormalize 4 quad points (TL, TR, BR, BL)
      const x0 = points[0].x * width;
      const y0 = points[0].y * height;
      const x1 = points[1].x * width;
      const y1 = points[1].y * height;
      const x2 = points[2].x * width;
      const y2 = points[2].y * height;
      const x3 = points[3].x * width;
      const y3 = points[3].y * height;

      // Calculate size of bounding quad using Euclidean distance
      const widthA = Math.hypot(x1 - x0, y1 - y0);
      const widthB = Math.hypot(x2 - x3, y2 - y3);
      const maxWidth = Math.round(Math.max(widthA, widthB));

      const heightA = Math.hypot(x3 - x0, y3 - y0);
      const heightB = Math.hypot(x2 - x1, y2 - y1);
      const maxHeight = Math.round(Math.max(heightA, heightB));

      if (maxWidth <= 0 || maxHeight <= 0) {
        return res.status(400).json({ error: "Invalid quad geometry dimensions." });
      }

      // Map src coordinates (quad corners) to destination rectangle (0 to max dimensions)
      const srcPtsData = [x0, y0, x1, y1, x2, y2, x3, y3];
      const dstPtsData = [0, 0, maxWidth, 0, maxWidth, maxHeight, 0, maxHeight];

      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, width, height);

      let srcMat = track(new cv.Mat(height, width, cv.CV_8UC4));
      srcMat.data.set(new Uint8ClampedArray(imgData.data));

      let srcPts = track(cv.matFromArray(4, 1, cv.CV_32FC2, srcPtsData));
      let dstPts = track(cv.matFromArray(4, 1, cv.CV_32FC2, dstPtsData));

      let M = track(cv.getPerspectiveTransform(srcPts, dstPts));
      let warped = track(new cv.Mat());

      cv.warpPerspective(srcMat, warped, M, new cv.Size(maxWidth, maxHeight));

      const outCanvas = createCanvas(warped.cols, warped.rows);
      const outCtx = outCanvas.getContext('2d');
      const outImgData = outCtx.createImageData(warped.cols, warped.rows);
      outImgData.data.set(new Uint8ClampedArray(warped.data));
      outCtx.putImageData(outImgData, 0, 0);

      const buf = outCanvas.toBuffer('image/png');
      res.set("Content-Type", "image/png");
      res.send(buf);
    } catch (err: any) {
      console.error("Perspective warp error:", err);
      res.status(500).json({ error: err.message || "Failed to warp perspective" });
    } finally {
      for (const d of disposables) {
        try {
          if (d && typeof d.delete === 'function') d.delete();
        } catch (e) {
          console.error("Failed to delete cv object:", e);
        }
      }
    }
  });

  // Computer Vision ORB & Homography Alignment Endpoint (Protected by Firebase Auth)
  app.post("/api/align", requireAuth, (upload.fields([{ name: "target", maxCount: 1 }, { name: "base", maxCount: 1 }]) as any), async (req: express.Request, res: express.Response) => {
    const disposables: any[] = [];
    const track = <T>(obj: T): T => {
      if (obj && typeof (obj as any).delete === 'function') {
        disposables.push(obj);
      }
      return obj;
    };

    try {
      await ensureCVReady();
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const targetBuffer = files?.target?.[0]?.buffer;
      const baseBuffer = files?.base?.[0]?.buffer;
      
      if (!targetBuffer) {
        return res.status(400).json({ error: "Missing target image file to align." });
      }
      if (!baseBuffer) {
        return res.status(400).json({ error: "Missing base reference image file to align against." });
      }

      const baseImg = await loadImage(baseBuffer);
      const targetImg = await loadImage(targetBuffer);

      const baseCanvas = createCanvas(baseImg.width, baseImg.height);
      const baseCtx = baseCanvas.getContext('2d');
      baseCtx.drawImage(baseImg, 0, 0);
      const baseData = baseCtx.getImageData(0, 0, baseImg.width, baseImg.height);

      const targetCanvas = createCanvas(targetImg.width, targetImg.height);
      const targetCtx = targetCanvas.getContext('2d');
      targetCtx.drawImage(targetImg, 0, 0);
      const targetData = targetCtx.getImageData(0, 0, targetImg.width, targetImg.height);

      let base = processImageForCV(baseData, track);
      let target = processImageForCV(targetData, track);

      const MAX_FEATURES = 5000;
      let orb = track(new cv.ORB(MAX_FEATURES));

      let kp1 = track(new cv.KeyPointVector());
      let des1 = track(new cv.Mat());
      orb.detectAndCompute(base.gray, track(new cv.Mat()), kp1, des1);

      let kp2 = track(new cv.KeyPointVector());
      let des2 = track(new cv.Mat());
      orb.detectAndCompute(target.gray, track(new cv.Mat()), kp2, des2);

      if (des1.empty() || des2.empty() || des1.rows === 0 || des2.rows === 0) {
        throw new Error("Alignment failed: No distinctive visual keypoints found in the images. Please ensure the photos clearly show brushstrokes.");
      }

      let matcher = track(new cv.BFMatcher(cv.NORM_HAMMING, true));
      let matches = track(new cv.DMatchVector());
      matcher.match(des1, des2, matches);

      let minDist = 10000;
      for (let i = 0; i < matches.size(); i++) {
        let m = matches.get(i);
        if (m.distance < minDist) minDist = m.distance;
      }
      
      let good_matches = [];
      for (let i = 0; i < matches.size(); i++) {
        let m = matches.get(i);
        if (m.distance <= Math.max(2 * minDist, 30.0)) {
          good_matches.push(m);
        }
      }

      if (good_matches.length < 10) {
        throw new Error("Alignment failed: Could not find sufficient matching features between the two milestones. Please check framing.");
      }

      let srcPtsData = [];
      let dstPtsData = [];
      for (let i = 0; i < good_matches.length; i++) {
        let m = good_matches[i];
        let p1 = kp1.get(m.queryIdx).pt; 
        let p2 = kp2.get(m.trainIdx).pt; 
        
        dstPtsData.push(p1.x / base.scale);
        dstPtsData.push(p1.y / base.scale);
        
        srcPtsData.push(p2.x / target.scale);
        srcPtsData.push(p2.y / target.scale);
      }
      
      let srcPts = track(cv.matFromArray(good_matches.length, 1, cv.CV_32FC2, srcPtsData));
      let dstPts = track(cv.matFromArray(good_matches.length, 1, cv.CV_32FC2, dstPtsData));

      let M = track(cv.findHomography(srcPts, dstPts, cv.RANSAC, 5.0));
      if (M.empty()) {
        throw new Error("Could not determine perspective alignment matrix.");
      }

      // Homography distortion sanity verification
      let isValid = true;
      if (M.rows === 3 && M.cols === 3) {
        let h0 = M.doubleAt(0, 0);
        let h1 = M.doubleAt(0, 1);
        let h3 = M.doubleAt(1, 0);
        let h4 = M.doubleAt(1, 1);
        let h6 = M.doubleAt(2, 0);
        let h7 = M.doubleAt(2, 1);
        let h8 = M.doubleAt(2, 2);

        if (Math.abs(h8) > 0.0001) {
          h0 /= h8; h1 /= h8; h3 /= h8; h4 /= h8; h6 /= h8; h7 /= h8;
        }

        const scaleX = Math.sqrt(h0 * h0 + h3 * h3);
        const scaleY = Math.sqrt(h1 * h1 + h4 * h4);
        const skew = Math.abs(h0 * h1 + h3 * h4) / (scaleX * scaleY || 1);

        if (scaleX < 0.4 || scaleX > 2.2 || scaleY < 0.4 || scaleY > 2.2 || skew > 0.5 || Math.abs(h6) > 0.008 || Math.abs(h7) > 0.008) {
          isValid = false;
        }
      } else {
        isValid = false;
      }

      if (!isValid) {
        throw new Error("Alignment failed: Calculated warp is too distorted. Keep your camera flat and steady against the frame.");
      }

      let aligned = track(new cv.Mat());
      cv.warpPerspective(target.rawMat, aligned, M, new cv.Size(base.rawMat.cols, base.rawMat.rows));

      const outCanvas = createCanvas(aligned.cols, aligned.rows);
      const outCtx = outCanvas.getContext('2d');
      const outImgData = outCtx.createImageData(aligned.cols, aligned.rows);
      outImgData.data.set(new Uint8ClampedArray(aligned.data));
      outCtx.putImageData(outImgData, 0, 0);

      const buffer = outCanvas.toBuffer("image/png");
      res.set('Content-Type', 'image/png');
      res.send(buffer);
    } catch(err: any) {
      console.error("Align error: ", err);
      res.status(500).json({ error: err.message || "Failed to align images" });
    } finally {
      for (const dec of disposables) {
        try {
          if (dec && typeof dec.delete === 'function') dec.delete();
        } catch (e) {
          console.error("Failed to delete cv object:", e);
        }
      }
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
