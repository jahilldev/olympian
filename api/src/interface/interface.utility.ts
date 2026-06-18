import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { static as serveStatic } from 'express';
import type { Request, Response, NextFunction } from 'express';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const distPath = join(__dirname, '..', '..', '..', 'app', 'dist');

/**
 * Serves static assets from app/dist and falls back to the correct page shell
 * for SPA routes. Registered on the raw Express instance BEFORE NestJS's router
 * so it runs for every request, including paths with no controller.
 */
export function attachInterface(server: ReturnType<typeof express>): void {
  const staticHandler = serveStatic(distPath);

  server.use((req: Request, res: Response, next: NextFunction) => {
    staticHandler(req, res, () => {
      if (
        req.method !== 'GET' ||
        req.path.startsWith('/api/') ||
        req.path.startsWith('/stream/') ||
        req.path.startsWith('/webhooks/') ||
        req.path.startsWith('/langfuse/')
      ) {
        return next();
      }

      const p = req.path;

      if (/^\/jobs\/[^/]+\/runs\/[^/]/.test(p)) {
        return res.sendFile(join(distPath, 'jobs', 'runs', 'index.html'));
      }
      if (/^\/jobs\/[^/]+\/verifications\/[^/]/.test(p)) {
        return res.sendFile(join(distPath, 'jobs', 'verifications', 'index.html'));
      }
      if (/^\/jobs\/[^/]/.test(p)) {
        return res.sendFile(join(distPath, 'jobs', 'index.html'));
      }
      res.sendFile(join(distPath, 'index.html'));
    });
  });
}
