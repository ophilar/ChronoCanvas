import { z } from 'zod';

const normalizedCoordinateSchema = z.number().finite().min(0).max(1);

export const detectionMethodSchema = z.enum(['opencv', 'gemini']);

export const perspectivePointSchema = z
  .object({
    x: normalizedCoordinateSchema,
    y: normalizedCoordinateSchema,
  })
  .strict();

export const perspectivePointsSchema = z.array(perspectivePointSchema).length(4);
export type PerspectivePoint = z.infer<typeof perspectivePointSchema>;

export const geminiBoundsSchema = z
  .object({
    ymin: normalizedCoordinateSchema,
    xmin: normalizedCoordinateSchema,
    ymax: normalizedCoordinateSchema,
    xmax: normalizedCoordinateSchema,
  })
  .strict()
  .refine((bounds) => bounds.xmin < bounds.xmax && bounds.ymin < bounds.ymax, {
    message: 'Canvas bounds must have positive normalized extents.',
  });

export const dataUrlSchema = z
  .string()
  .regex(/^data:[^;,]+;base64,[A-Za-z0-9+/]+={0,2}$/, 'Image data must be a valid base64 data URL.')
  .transform((value) => {
    const marker = ';base64,';
    const separator = value.indexOf(marker);
    return {
      mimeType: value.slice('data:'.length, separator),
      data: value.slice(separator + marker.length),
    };
  });
