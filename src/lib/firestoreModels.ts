import { z } from 'zod';
import type { Artwork, Layer } from '../types';

const isoDateTimeSchema = z.string().datetime();

const artworkDocumentSchema: z.ZodType<Omit<Artwork, 'id'>> = z
  .object({
    title: z.string().min(1),
    description: z.string().optional(),
    status: z.enum(['in_progress', 'completed', 'archived']),
    ownerId: z.string().min(1),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

const layerDocumentSchema = z
  .object({
    imageUrl: z.string().min(1),
    notes: z.string().optional(),
    techniques: z.array(z.string()).optional(),
    colorPaletteSuggestions: z.array(z.string()).optional(),
    createdAt: isoDateTimeSchema,
    order: z.number().int().nonnegative().optional(),
    artworkId: z.string().min(1).optional(),
    ownerId: z.string().min(1).optional(),
  })
  .strict()
  .transform(({ artworkId: _artworkId, ownerId: _ownerId, ...layer }) => layer);

export function parseArtworkDocument(id: string, data: unknown): Artwork {
  return { id, ...artworkDocumentSchema.parse(data) };
}

export function parseLayerDocument(id: string, data: unknown): Layer {
  const layer: Omit<Layer, 'id'> = layerDocumentSchema.parse(data);
  return { id, ...layer };
}
