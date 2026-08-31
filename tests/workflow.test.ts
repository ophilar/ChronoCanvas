import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canvasBoundsToCrop,
  createStorageObjectPath,
  createTimelapseTiming,
  getMilestoneMoveTarget,
} from '../src/lib/workflow';

test('canvasBoundsToCrop converts normalized bounds into an exact classic crop', () => {
  const result = canvasBoundsToCrop(
    { ymin: 0.1, xmin: 0.2, ymax: 0.9, xmax: 0.8 },
    1000,
    800,
  );

  assert.deepEqual(result.croppedAreaPixels, {
    x: 200,
    y: 80,
    width: 600,
    height: 640,
  });
  assert.equal(result.aspectRatio, 600 / 640);
  assert.equal(result.crop.x, 0);
  assert.equal(result.crop.y, 0);
  assert.equal(result.zoom, 1.25);
});

test('canvasBoundsToCrop rejects invalid detector output instead of inventing a crop', () => {
  assert.throws(
    () => canvasBoundsToCrop({ ymin: 0.4, xmin: 0.8, ymax: 0.2, xmax: 0.9 }, 1000, 800),
    /Invalid canvas bounds/,
  );
  assert.throws(
    () => canvasBoundsToCrop({ ymin: -0.1, xmin: 0.1, ymax: 0.8, xmax: 0.9 }, 1000, 800),
    /Invalid canvas bounds/,
  );
});

test('getMilestoneMoveTarget keeps the baseline first', () => {
  assert.equal(getMilestoneMoveTarget(0, 'down', 3), null);
  assert.equal(getMilestoneMoveTarget(1, 'up', 3), null);
  assert.equal(getMilestoneMoveTarget(1, 'down', 3), 2);
  assert.equal(getMilestoneMoveTarget(2, 'up', 3), 1);
  assert.equal(getMilestoneMoveTarget(2, 'down', 3), null);
});

test('createTimelapseTiming honors the configured frame interval for cut transitions', () => {
  assert.deepEqual(createTimelapseTiming(500, 'cut', 30), {
    frameDelayMs: 500,
    holdMs: 500,
    transitionDurationMs: 0,
    transitionFrames: 0,
    transitionStepMs: 0,
  });
});

test('createTimelapseTiming budgets fade time inside the configured frame interval', () => {
  const timing = createTimelapseTiming(500, 'fade', 30);

  assert.equal(timing.frameDelayMs, 500);
  assert.equal(timing.transitionDurationMs, 375);
  assert.equal(timing.holdMs, 125);
  assert.equal(timing.transitionFrames, 11);
  assert.ok(Math.abs(timing.transitionStepMs - 375 / 11) < 1e-9);
});

test('createTimelapseTiming rejects invalid timing rather than applying defaults', () => {
  assert.throws(() => createTimelapseTiming(0, 'fade', 30), /frameDelayMs/);
  assert.throws(() => createTimelapseTiming(500, 'fade', 0), /framesPerSecond/);
});

test('createStorageObjectPath scopes every image to the authenticated user and artwork', () => {
  const path = createStorageObjectPath('user-123', 'artwork-456', 'image.jpg');
  assert.equal(path, 'users/user-123/artworks/artwork-456/layers/image.jpg');
});

test('createStorageObjectPath rejects path separators in identifiers and filenames', () => {
  assert.throws(() => createStorageObjectPath('user/123', 'artwork', 'image.jpg'), /path segment/);
  assert.throws(() => createStorageObjectPath('user', 'artwork', '../image.jpg'), /path segment/);
});
