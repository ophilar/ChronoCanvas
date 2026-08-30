import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import express from 'express';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };
import {
  ComputerVisionService,
  type PerspectivePoint,
} from './src/server/computerVisionService';
import { parseRequiredPort, registerSpaFallback } from './src/server/runtime';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const JSON_BODY_LIMIT = '15mb';
const ACCEPTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

dotenv.config();
const localEnvironmentPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(localEnvironmentPath)) {
  dotenv.config({ path: localEnvironmentPath, override: true });
}

if (getApps().length === 0) {
  initializeApp({ projectId: firebaseConfig.projectId });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function requireAuth(
  request: express.Request,
  response: express.Response,
  next: express.NextFunction,
) {
  const authorization = request.headers.authorization;
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  if (!match) {
    return response.status(401).json({ error: 'Unauthorized: missing or invalid Authorization header.' });
  }

  try {
    await getAuth().verifyIdToken(match[1]);
    next();
  } catch (error) {
    console.warn('Rejected invalid Firebase ID token:', error);
    return response.status(401).json({ error: 'Unauthorized: invalid Firebase token.' });
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 2,
  },
  fileFilter: (_request, file, callback) => {
    if (!ACCEPTED_IMAGE_TYPES.has(file.mimetype)) {
      callback(new Error(`Unsupported image content type: ${file.mimetype}`));
      return;
    }
    callback(null, true);
  },
});

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseDataUrl(value: unknown): { buffer: Buffer; mimeType: string } | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  if (!ACCEPTED_IMAGE_TYPES.has(match[1])) {
    throw new Error(`Unsupported image content type: ${match[1]}`);
  }
  return { buffer: Buffer.from(match[2], 'base64'), mimeType: match[1] };
}

function parseDetectionMethod(request: express.Request): 'opencv' | 'gemini' {
  const body = record(request.body);
  const queryMethod = request.query.method;
  const value = typeof body.method === 'string' ? body.method : queryMethod;
  if (value !== 'opencv' && value !== 'gemini') {
    throw new Error('Detection method must be either "opencv" or "gemini".');
  }
  return value;
}

function parsePerspectivePoints(value: unknown): PerspectivePoint[] {
  if (typeof value !== 'string') {
    throw new Error('Missing perspective point coordinates.');
  }

  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error('Perspective point coordinates must be an array.');
  }

  return parsed.map((point) => {
    const candidate = record(point);
    if (typeof candidate.x !== 'number' || typeof candidate.y !== 'number') {
      throw new Error('Every perspective point must contain numeric x and y coordinates.');
    }
    return { x: candidate.x, y: candidate.y };
  });
}

async function startServer(): Promise<void> {
  const port = parseRequiredPort(process.env.PORT);
  const computerVision = new ComputerVisionService();
  await computerVision.assertReady();

  const app = express();
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.post(
    '/api/detect-canvas-bounds',
    requireAuth,
    upload.single('file'),
    async (request, response) => {
      try {
        const body = record(request.body);
        const dataUrl = parseDataUrl(body.image);
        const imageBuffer = request.file?.buffer ?? dataUrl?.buffer;
        const mimeType = request.file?.mimetype ?? dataUrl?.mimeType;
        if (!imageBuffer || !mimeType) {
          return response.status(400).json({ error: 'No image file or base64 data URL was provided.' });
        }

        const method = parseDetectionMethod(request);
        if (method === 'gemini') {
          const apiKey = process.env.GEMINI_API_KEY;
          const model = process.env.GEMINI_MODEL;
          if (!apiKey || !model) {
            return response.status(503).json({
              error: 'Gemini detection requires GEMINI_API_KEY and GEMINI_MODEL on the server.',
            });
          }

          const ai = new GoogleGenAI({ apiKey });
          const result = await ai.models.generateContent({
            model,
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType,
                    data: imageBuffer.toString('base64'),
                  },
                },
                {
                  text: "Analyze this image containing a painting. Locate the rectangular boundary of the physical painting canvas, cardboard, plate, or sheet of paper where the artwork is painted. Ignore background details such as walls, easels, frame borders outside the canvas, floors, and hands. Return only the painting boundary plus its normalized center, width, and height.",
                },
              ],
            },
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  ymin: { type: Type.NUMBER },
                  xmin: { type: Type.NUMBER },
                  ymax: { type: Type.NUMBER },
                  xmax: { type: Type.NUMBER },
                  centerX: { type: Type.NUMBER },
                  centerY: { type: Type.NUMBER },
                  width: { type: Type.NUMBER },
                  height: { type: Type.NUMBER },
                },
                required: ['ymin', 'xmin', 'ymax', 'xmax', 'centerX', 'centerY', 'width', 'height'],
              },
            },
          });

          if (!result.text) {
            throw new Error('Gemini returned no structured bounding-box response.');
          }
          const bounds: unknown = JSON.parse(result.text.trim());
          return response.json({ success: true, bounds, mode: 'gemini' });
        }

        const bounds = await computerVision.detectCanvasBounds(imageBuffer);
        const width = bounds.xmax - bounds.xmin;
        const height = bounds.ymax - bounds.ymin;
        return response.json({
          success: true,
          bounds: {
            ...bounds,
            centerX: bounds.xmin + width / 2,
            centerY: bounds.ymin + height / 2,
            width,
            height,
          },
          mode: 'opencv',
        });
      } catch (error) {
        console.error('Canvas detection failed:', error);
        return response.status(400).json({ error: errorMessage(error) });
      }
    },
  );

  app.post(
    '/api/perspective-warp',
    requireAuth,
    upload.single('file'),
    async (request, response) => {
      try {
        if (!request.file) {
          return response.status(400).json({ error: 'Missing image file.' });
        }
        const points = parsePerspectivePoints(record(request.body).points);
        const warped = await computerVision.warpPerspective(request.file.buffer, points);
        response.type('png').send(warped);
      } catch (error) {
        console.error('Perspective warp failed:', error);
        response.status(400).json({ error: errorMessage(error) });
      }
    },
  );

  app.post(
    '/api/align',
    requireAuth,
    upload.fields([
      { name: 'target', maxCount: 1 },
      { name: 'base', maxCount: 1 },
    ]),
    async (request, response) => {
      try {
        const files = request.files;
        if (!files || Array.isArray(files)) {
          return response.status(400).json({ error: 'Expected target and base image fields.' });
        }
        const targetBuffer = files.target?.[0]?.buffer;
        const baseBuffer = files.base?.[0]?.buffer;
        if (!targetBuffer || !baseBuffer) {
          return response.status(400).json({ error: 'Both target and base image files are required.' });
        }

        const aligned = await computerVision.align(targetBuffer, baseBuffer);
        response.type('png').send(aligned);
      } catch (error) {
        console.error('Milestone alignment failed:', error);
        response.status(400).json({ error: errorMessage(error) });
      }
    },
  );

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    registerSpaFallback(app, distPath);
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled request error:', error);
    if (error instanceof multer.MulterError) {
      response.status(400).json({ error: error.message });
      return;
    }
    response.status(400).json({ error: errorMessage(error) });
  });

  app.listen(port, '0.0.0.0', () => {
    console.log(`ChronoCanvas server listening on port ${port}.`);
  });
}

void startServer().catch((error: unknown) => {
  console.error('ChronoCanvas server failed to start:', error);
  process.exitCode = 1;
});
