import { promises as fs } from 'node:fs';
import path from 'node:path';

import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const ALLOWED_EXTENSIONS = new Set(['.jsp', '.js', '.html', '.htm']);

interface LocalRouteRequest {
  routes?: string[];
}

interface RouteFileResponse {
  filePath: string;
  content: string;
}

function normalizePathForApi(inputPath: string): string {
  return inputPath.replace(/\\/g, '/');
}

function isAllowedFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

async function collectFilesFromPath(targetPath: string, output: RouteFileResponse[]): Promise<void> {
  const stats = await fs.stat(targetPath);

  if (stats.isDirectory()) {
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    for (const entry of entries) {
      await collectFilesFromPath(path.join(targetPath, entry.name), output);
    }
    return;
  }

  if (!stats.isFile() || !isAllowedFile(targetPath)) {
    return;
  }

  const content = await fs.readFile(targetPath, 'utf-8');
  output.push({
    filePath: normalizePathForApi(targetPath),
    content,
  });
}

function localRoutesPlugin(): Plugin {
  const isRoutesApiRequest = (request: any): boolean => {
    const rawUrl = typeof request.url === 'string' ? request.url : '';
    const pathname = rawUrl.split('?')[0];
    return pathname.endsWith('/api/local-routes/files') || pathname.endsWith('/api/local-routes/files/');
  };

  const handler = async (request: any, response: any): Promise<void> => {
    if (request.method !== 'POST') {
      response.statusCode = 405;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ error: 'Metodo no permitido.' }));
      return;
    }

    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });

    request.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}') as LocalRouteRequest;
        const routes = (payload.routes ?? []).filter((route): route is string => typeof route === 'string' && route.trim().length > 0);

        const files: RouteFileResponse[] = [];
        for (const routePath of routes) {
          const absolutePath = path.resolve(routePath);
          await collectFilesFromPath(absolutePath, files);
        }

        const deduped = Array.from(new Map(files.map((file) => [file.filePath.toLowerCase(), file])).values());

        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ files: deduped }));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'No se pudieron leer las rutas.';
        response.statusCode = 400;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ error: message }));
      }
    });
  };

  return {
    name: 'local-routes-api',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!isRoutesApiRequest(request)) {
          next();
          return;
        }

        void handler(request, response);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!isRoutesApiRequest(request)) {
          next();
          return;
        }

        void handler(request, response);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localRoutesPlugin()],
});
