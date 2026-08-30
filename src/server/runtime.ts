import path from 'node:path';
import type { Express } from 'express';

export function parseRequiredPort(value: string | undefined): number {
  if (value === undefined) {
    throw new Error('PORT must be configured explicitly.');
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return port;
}

export function registerSpaFallback(app: Express, distPath: string): void {
  app.get('/{*splat}', (_request, response) => {
    response.sendFile(path.join(distPath, 'index.html'));
  });
}
