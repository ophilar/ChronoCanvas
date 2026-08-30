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
import {
  RequestValidationError,
  toHttpErrorResponse,
  UpstreamServiceError,
} from './src/server/httpErrorPolicy';
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

async function requireAuth(
  request: express.Request,
  response: express.Response,
  next: express.NextFunction,
) {
  const authorization = request.headers.authorization;
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  if (!match) {
    response.status(401).json({ error: 'Unauthorized: missing or invalid Authorization header.' });
    return;
  }

  try {
    await getAuth().verifyIdToken(match[1]);
    next();
  } catch (error) {
    console.warn('Rejected invalid Firebase ID token:', error);
    response.status(401).json({ error: 'Unauthorized: invalid Firebase token.' });
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
      callback(new RequestValidationError(`Unsupported image content type: ${file.mimetype}`));
      return;
    }
    callback(null, true);
  },
});

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RequestValidationError(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function parseDataUrl(value: unknown): { buffer: Buffer; mimeType: string } | null {
  if (value === undefined) return null;
  if (typeof value !== 'string') {
    throw new RequestValidationError('Image data must be a base64 data URL string.');
  }

  const match = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new RequestValidationError('Image data must be a valid base64 data URL.');
  }
  if (!ACCEPTED_IMAGE_TYPES.has(match[1])) {
    throw new RequestValidationError(`Unsupported image content type: ${match[1]}`);
  }
  return { buffer: Buffer.from(match[2], 'base64'), mimeType: match[1] };
}

function parseDetectionMethod(request: express.Request): 'opencv' | 'gemini' {
  const body = requireRecord(request.body, 'Request body');
  const value = typeof body.method === 'string' ? body.method : request.query.method;
  if (value !== 'opencv' && value !== 'gemini') {
    throw new RequestValidationError('Detection method must be either "opencv" or "gemini".');
  }
  return value;
}

function parsePerspectivePoints(value: unknown): PerspectivePoint[] {
  if (typeof value !== 'string') {
    throw new RequestValidationError('Missing perspective point coordinates.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new RequestValidationError('Perspective point coordinates must be valid JSON.', {
      cause: error,
    });
  }
  if (!Array.isArray(parsed)) {
    throw new RequestValidationError('Perspective point coordinates must be an array.');
  }

  return parsed.map((point, index) => {
    const candidate = requireRecord(point, `Perspective point ${index + 1}`);
    if (typeof candidate.x !== 'number' || typeof candidate.y !== 'number') {
      throw new RequestValidationError(
        `Perspective point ${index + 1} must contain numeric x and y coordinates.`,
      );
    }
    return { x: candidate.x, y: candidate.y };
  });
}

function parseGeminiBounds(text: string): Record<string, number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new UpstreamServiceError('Gemini canvas detection returned invalid structured data.', {
      cause: error,
    });
  }

  const bounds =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  const keys = ['ymin', 'xmin', 'ymax', 'xmax', 'centerX', 'centerY', 'width', 'height'] as const;
  if (!bounds || keys.some((key) => typeof bounds[key] !== 'number' || !Number.isFinite(bounds[key]))) {
    throw new UpstreamServiceError('Gemini canvas detection returned invalid structured data.');
  }

  return Object.fromEntries(keys.map((key) => [key, bounds[key] as number]));
}

function normalizeMiddlewareError(error: unknown): unknown {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return new RequestValidationError(`Image upload exceeds the ${MAX_UPLOAD_BYTES} byte limit.`);
    }
    if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
      return new RequestValidationError('Image upload contains an unexpected number of files.');
    }
    return new RequestValidationError('Invalid multipart image upload.');
  }

  if (
    error instanceof SyntaxError &&
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    error.type === 'entity.parse.failed'
  ) {
    return new RequestValidationError('Request body contains invalid JSON.');
  }
  return error;
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
      const body = requireRecord(request.body, 'Request body');
      const dataUrl = parseDataUrl(body.image);
      const imageBuffer = request.file?.buffer ?? dataUrl?.buffer;
      const mimeType = request.file?.mimetype ?? dataUrl?.mimeType;
      if (!imageBuffer || !mimeType) {
        throw new RequestValidationError('No image file or base64 data URL was provided.');
      }

      const method = parseDetectionMethod(request);
      if (method === 'gemini') {
        const apiKey = process.env.GEMINI_API_KEY;
        const model = process.env.GEMINI_MODEL;
        if (!apiKey || !model) {
          response.status(503).json({
            error: 'Gemini detection requires GEMINI_API_KEY and GEMINI_MODEL on the server.',
          });
          return;
        }

        const ai = new GoogleGenAI({ apiKey });
        let result;
        try {
          result = await ai.models.generateContent({
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
        } catch (error) {
          throw new UpstreamServiceError('Gemini canvas detection failed.', { cause: error });
        }

        if (!result.text) {
          throw new UpstreamServiceError('Gemini canvas detection returned no structured data.');
        }
        response.json({ success: true, bounds: parseGeminiBounds(result.text.trim()), mode: 'gemini' });
        return;
      }

      const bounds = await computerVision.detectCanvasBounds(imageBuffer);
      const width = bounds.xmax - bounds.xmin;
      const height = bounds.ymax - bounds.ymin;
      response.json({
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
    },
  );

  app.post(
    '/api/perspective-warp',
    requireAuth,
    upload.single('file'),
    async (request, response) => {
      if (!request.file) {
        throw new RequestValidationError('Missing image file.');
      }
      const body = requireRecord(request.body, 'Request body');
      const points = parsePerspectivePoints(body.points);
      const warped = await computerVision.warpPerspective(request.file.buffer, points);
      response.type('png').send(warped);
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
      const files = request.files;
      if (!files || Array.isArray(files)) {
        throw new RequestValidationError('Expected target and base image fields.');
      }
      const targetBuffer = files.target?.[0]?.buffer;
      const baseBuffer = files.base?.[0]?.buffer;
      if (!targetBuffer || !baseBuffer) {
        throw new RequestValidationError('Both target and base image files are required.');
      }

      const aligned = await computerVision.align(targetBuffer, baseBuffer);
      response.type('png').send(aligned);
    },
  );

  app.all('/api/{*splat}', (_request, response) => {
    response.status(404).json({ error: 'API route not found.' });
  });

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

  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error('Unhandled request error:', error);
      const publicError = toHttpErrorResponse(normalizeMiddlewareError(error));
      response.status(publicError.status).json({ error: publicError.message });
    },
  );

  app.listen(port, '0.0.0.0', () => {
    console.log(`ChronoCanvas server listening on port ${port}.`);
  });
}

void startServer().catch((error: unknown) => {
  console.error('ChronoCanvas server failed to start:', error);
  process.exitCode = 1;
});
