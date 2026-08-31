import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvas } from 'canvas';
import { isHttpError } from 'http-errors';
import {
  assertImageDimensions,
  ComputerVisionService,
} from '../src/server/computerVisionService';
import {
  dataUrlSchema,
  detectionMethodSchema,
  geminiBoundsSchema,
  perspectivePointsSchema,
} from '../src/server/schemas';

test('server schemas reject missing and malformed values without defaults', () => {
  assert.equal(detectionMethodSchema.parse('opencv'), 'opencv');
  assert.equal(detectionMethodSchema.parse('gemini'), 'gemini');
  assert.throws(() => detectionMethodSchema.parse(undefined));
  assert.throws(() => detectionMethodSchema.parse('classic'));

  assert.deepEqual(
    perspectivePointsSchema.parse([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]),
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
  );
  assert.throws(() => perspectivePointsSchema.parse([{ x: 0, y: 0 }]));
  assert.throws(() => perspectivePointsSchema.parse([
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]));

  assert.deepEqual(
    geminiBoundsSchema.parse({ ymin: 0.1, xmin: 0.2, ymax: 0.9, xmax: 0.8 }),
    { ymin: 0.1, xmin: 0.2, ymax: 0.9, xmax: 0.8 },
  );
  assert.throws(() => geminiBoundsSchema.parse({ ymin: 0.8, xmin: 0.2, ymax: 0.1, xmax: 0.8 }));
  assert.throws(() => geminiBoundsSchema.parse({
    ymin: 0.1,
    xmin: 0.2,
    ymax: 0.9,
    xmax: 0.8,
    centerX: 0.5,
  }));

  assert.deepEqual(dataUrlSchema.parse('data:image/png;base64,AA=='), {
    mimeType: 'image/png',
    data: 'AA==',
  });
  assert.throws(() => dataUrlSchema.parse('image/png;base64,AA=='));
  assert.throws(() => dataUrlSchema.parse('data:image/svg+xml;base64,AA=='));
});

test('decoded image dimensions are bounded before CV allocation', () => {
  assert.doesNotThrow(() => assertImageDimensions(4096, 4096));

  for (const operation of [
    () => assertImageDimensions(6000, 4000),
    () => assertImageDimensions(0, 4000),
  ]) {
    assert.throws(operation, (error: unknown) => {
      assert.ok(isHttpError(error));
      assert.equal(error.statusCode, 400);
      return true;
    });
  }
});

test('ComputerVisionService resolves the installed OpenCV 5 module before use', async () => {
  const service = new ComputerVisionService();
  await service.assertReady();
});

test('canvas detection rejects an image with no detectable canvas contour', async () => {
  const canvas = createCanvas(200, 200);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const service = new ComputerVisionService();
  await assert.rejects(
    () => service.detectCanvasBounds(canvas.toBuffer('image/png')),
    (error: unknown) => {
      assert.ok(isHttpError(error));
      assert.equal(error.statusCode, 422);
      assert.match(error.message, /could not detect a canvas boundary/i);
      return true;
    },
  );
});

test('invalid image bytes are an explicit image-processing failure', async () => {
  const service = new ComputerVisionService();
  await assert.rejects(
    () => service.detectCanvasBounds(Buffer.from('not-an-image')),
    (error: unknown) => {
      assert.ok(isHttpError(error));
      assert.equal(error.statusCode, 422);
      assert.match(error.message, /could not be decoded/i);
      return true;
    },
  );
});

test('perspective warp rejects coordinates outside normalized image bounds', async () => {
  const canvas = createCanvas(100, 100);
  const service = new ComputerVisionService();

  await assert.rejects(
    () => service.warpPerspective(canvas.toBuffer('image/png'), [
      { x: 0, y: 0 },
      { x: 1.2, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]),
    (error: unknown) => {
      assert.ok(isHttpError(error));
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /normalized range/i);
      return true;
    },
  );
});
