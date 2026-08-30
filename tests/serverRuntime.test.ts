import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCanvas } from 'canvas';
import express from 'express';
import {
  assertImageDimensions,
  ComputerVisionService,
} from '../src/server/computerVisionService';
import { parseRequiredPort, registerSpaFallback } from '../src/server/runtime';

test('parseRequiredPort accepts an explicit valid TCP port', () => {
  assert.equal(parseRequiredPort('8080'), 8080);
});

test('parseRequiredPort rejects missing, fractional, and out-of-range ports', () => {
  assert.throws(() => parseRequiredPort(undefined), /PORT/);
  assert.throws(() => parseRequiredPort('3000.5'), /PORT/);
  assert.throws(() => parseRequiredPort('0'), /PORT/);
  assert.throws(() => parseRequiredPort('65536'), /PORT/);
});

test('decoded image dimensions are bounded before CV allocation', () => {
  assert.doesNotThrow(() => assertImageDimensions(4096, 4096));
  assert.throws(() => assertImageDimensions(6000, 4000), /pixel limit/i);
  assert.throws(() => assertImageDimensions(0, 4000), /positive integers/i);
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
    /could not detect a canvas boundary/i,
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
    /normalized range/i,
  );
});

test('Express 5 SPA fallback serves root and nested client routes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'chronocanvas-spa-'));
  await writeFile(path.join(directory, 'index.html'), '<main>ChronoCanvas SPA</main>', 'utf8');

  const app = express();
  app.use(express.static(directory));
  registerSpaFallback(app, directory);

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP server address.');
    const origin = `http://127.0.0.1:${address.port}`;

    const rootResponse = await fetch(`${origin}/`);
    const nestedResponse = await fetch(`${origin}/artwork/example`);

    assert.equal(rootResponse.status, 200);
    assert.equal(nestedResponse.status, 200);
    assert.match(await rootResponse.text(), /ChronoCanvas SPA/);
    assert.match(await nestedResponse.text(), /ChronoCanvas SPA/);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(directory, { recursive: true, force: true });
  }
});
