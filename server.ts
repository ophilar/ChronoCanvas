import path from 'node:path';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import express from 'express';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import createError, { isHttpError } from 'http-errors';
import multer from 'multer';
import { z } from 'zod';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };
import { ComputerVisionService } from './src/server/computerVisionService';
import {
  detectionRequestBodySchema,
  geminiBoundsSchema,
  imageMimeTypeSchema,
  perspectiveRequestBodySchema,
} from './src/server/schemas';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_JSON_BODY_BYTES = Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 1024;

dotenv.config({ path: '.env.local', quiet: true });

if (getApps().length === 0) {
  initializeApp({ projectId: firebaseConfig.projectId });
}

async function requireAuth(
  request: express.Request,
  _response: express.Response,
  next: express.NextFunction,
): Promise<void> {
  const authorization = request.headers.authorization;
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  if (!match) {
    next(createError(401, 'Unauthorized: missing or invalid Authorization header.'));
    return;
  }

  try {
    await getAuth().verifyIdToken(match[1]);
    next();
  } catch (error) {
    console.warn('Rejected invalid Firebase ID token:', error);
    next(createError(401, 'Unauthorized: invalid Firebase token.', { cause: error }));
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 2,
  },
  fileFilter: (_request, file, callback) => {
    if (!imageMimeTypeSchema.safeParse(file.mimetype).success) {
      callback(createError(415, `Unsupported image content type: ${file.mimetype}`));
      return;
    }
    callback(null, true);
  },
});

function isExpressJsonSyntaxError(error: unknown): boolean {
  return (
    error instanceof SyntaxError &&
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === 400
  );
}

async function startServer(): Promise<void> {
  const port = Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be configured as an integer between 1 and 65535.');
  }

  const computerVision = new ComputerVisionService();
  await computerVision.assertReady();

  const app = express();
  app.use(express.json({ limit: MAX_JSON_BODY_BYTES }));

  app.post(
    '/api/detect-canvas-bounds',
    requireAuth,
    upload.single('file'),
    async (request, response) => {
      const body = detectionRequestBodySchema.parse(request.body);
      const hasFile = request.file !== undefined;
      const hasDataUrl = body.image !== undefined;
      if (hasFile === hasDataUrl) {
        throw createError(400, 'Provide exactly one image source: multipart file or base64 data URL.');
      }

      let imageBuffer: Buffer;
      let mimeType: z.infer<typeof imageMimeTypeSchema>;
      if (request.file) {
        imageBuffer = request.file.buffer;
        mimeType = imageMimeTypeSchema.parse(request.file.mimetype);
      } else if (body.image) {
        imageBuffer = Buffer.from(body.image.data, 'base64');
        mimeType = body.image.mimeType;
      } else {
        throw new Error('Image-source validation succeeded without an image.');
      }

      if (body.method === 'gemini') {
        const apiKey = process.env.GEMINI_API_KEY;
        const model = process.env.GEMINI_MODEL;
        if (!apiKey || !model) {
          throw createError(503, 'Gemini detection requires GEMINI_API_KEY and GEMINI_MODEL.', {
            expose: true,
          });
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
                  text: 'Locate the rectangular boundary of the physical painting surface. Ignore the surrounding wall, easel, frame exterior, floor, hands, and other background objects. Return only normalized ymin, xmin, ymax, and xmax coordinates for the painting surface.',
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
                },
                required: ['ymin', 'xmin', 'ymax', 'xmax'],
              },
            },
          });
        } catch (error) {
          throw createError(502, 'Gemini canvas detection failed.', {
            cause: error,
            expose: true,
          });
        }

        if (!result.text) {
          throw createError(502, 'Gemini canvas detection returned no structured data.', {
            expose: true,
          });
        }

        let parsedBounds: unknown;
        try {
          parsedBounds = JSON.parse(result.text);
        } catch (error) {
          throw createError(502, 'Gemini canvas detection returned invalid structured data.', {
            cause: error,
            expose: true,
          });
        }

        const parsedResult = geminiBoundsSchema.safeParse(parsedBounds);
        if (!parsedResult.success) {
          throw createError(502, 'Gemini canvas detection returned invalid structured data.', {
            cause: parsedResult.error,
            expose: true,
          });
        }

        const bounds = parsedResult.data;
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
          mode: 'gemini',
        });
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
      if (!request.file) throw createError(400, 'Missing image file.');
      const { points } = perspectiveRequestBodySchema.parse(request.body);
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
        throw createError(400, 'Expected target and base image fields.');
      }
      const targetBuffer = files.target?.[0]?.buffer;
      const baseBuffer = files.base?.[0]?.buffer;
      if (!targetBuffer || !baseBuffer) {
        throw createError(400, 'Both target and base image files are required.');
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
    app.get('/{*splat}', (_request, response) => {
      response.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
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

      if (error instanceof multer.MulterError) {
        const message =
          error.code === 'LIMIT_FILE_SIZE'
            ? `Image upload exceeds the ${MAX_UPLOAD_BYTES} byte limit.`
            : 'Invalid multipart image upload.';
        response.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: message });
        return;
      }

      if (error instanceof z.ZodError || isExpressJsonSyntaxError(error)) {
        response.status(400).json({ error: 'Invalid request payload.' });
        return;
      }

      if (isHttpError(error)) {
        response
          .status(error.statusCode)
          .json({ error: error.expose ? error.message : 'Internal server error.' });
        return;
      }

      response.status(500).json({ error: 'Internal server error.' });
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
