import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArtworkDocument, parseLayerDocument } from '../src/lib/firestoreModels';

test('parseArtworkDocument rejects malformed persisted dates', () => {
  assert.throws(
    () =>
      parseArtworkDocument('artwork-1', {
        title: 'Study',
        status: 'in_progress',
        ownerId: 'user-1',
        createdAt: 'not-a-date',
        updatedAt: '2026-08-30T20:00:00.000Z',
      }),
    /Invalid ISO datetime/,
  );
});

test('parseLayerDocument accepts and removes legacy ownership fields', () => {
  const layer = parseLayerDocument('layer-1', {
    artworkId: 'artwork-1',
    ownerId: 'user-1',
    imageUrl: 'https://example.com/layer.jpg',
    techniques: [],
    colorPaletteSuggestions: [],
    createdAt: '2026-08-30T20:00:00.000Z',
    order: 0,
  });

  assert.deepEqual(layer, {
    id: 'layer-1',
    imageUrl: 'https://example.com/layer.jpg',
    techniques: [],
    colorPaletteSuggestions: [],
    createdAt: '2026-08-30T20:00:00.000Z',
    order: 0,
  });
  assert.equal('ownerId' in layer, false);
  assert.equal('artworkId' in layer, false);
});

test('parseLayerDocument rejects malformed persisted dates', () => {
  assert.throws(
    () =>
      parseLayerDocument('layer-1', {
        imageUrl: 'https://example.com/layer.jpg',
        createdAt: 'invalid',
      }),
    /Invalid ISO datetime/,
  );
});
