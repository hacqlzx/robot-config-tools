import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import {
  POTREE_PUBLIC_ROOT,
  POTREE_REQUIRED_ASSETS,
  POTREE_RUNTIME_DIRECTORIES,
} from "./potree-assets";

interface PotreeAssetsPluginOptions {
  sourceRoot: string;
}

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function listFiles(root: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...listFiles(absolutePath));
    } else if (entry.isFile()) {
      result.push(absolutePath);
    }
  }
  return result;
}

function validateRuntimeAssets(sourceRoot: string): void {
  const missing = POTREE_REQUIRED_ASSETS.filter(
    (relativePath) => !existsSync(path.join(sourceRoot, relativePath)),
  );
  if (missing.length > 0) {
    throw new Error(`Potree runtime assets are incomplete:\n${missing.join("\n")}`);
  }
}

function resolveRequestedAsset(sourceRoot: string, requestPath: string): string | null {
  const relativePath = requestPath.slice(`/${POTREE_PUBLIC_ROOT}/`.length);
  const absolutePath = path.resolve(sourceRoot, decodeURIComponent(relativePath));
  const relativeToRoot = path.relative(sourceRoot, absolutePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) return null;
  return absolutePath;
}

export function potreeAssetsPlugin({ sourceRoot }: PotreeAssetsPluginOptions): Plugin {
  const absoluteSourceRoot = path.resolve(sourceRoot);

  return {
    name: "potree-runtime-assets",

    buildStart() {
      validateRuntimeAssets(absoluteSourceRoot);
    },

    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestPath = new URL(request.url ?? "/", "http://localhost").pathname;
        if (!requestPath.startsWith(`/${POTREE_PUBLIC_ROOT}/`)) {
          next();
          return;
        }

        const absolutePath = resolveRequestedAsset(absoluteSourceRoot, requestPath);
        if (!absolutePath || !existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
          response.statusCode = absolutePath ? 404 : 403;
          response.end();
          return;
        }

        response.setHeader(
          "Content-Type",
          CONTENT_TYPES[path.extname(absolutePath).toLowerCase()] ?? "application/octet-stream",
        );
        if (request.method === "HEAD") {
          response.end();
          return;
        }

        const stream = createReadStream(absolutePath);
        stream.on("error", next);
        stream.pipe(response);
      });
    },

    generateBundle() {
      for (const directory of POTREE_RUNTIME_DIRECTORIES) {
        const directoryRoot = path.join(absoluteSourceRoot, directory);
        for (const absolutePath of listFiles(directoryRoot)) {
          const relativePath = path.relative(absoluteSourceRoot, absolutePath).replace(/\\/g, "/");
          this.emitFile({
            type: "asset",
            fileName: `${POTREE_PUBLIC_ROOT}/${relativePath}`,
            source: readFileSync(absolutePath),
          });
        }
      }
    },
  };
}
