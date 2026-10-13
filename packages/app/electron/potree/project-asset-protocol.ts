import { protocol } from "electron";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { assertInside } from "../project-core/project-paths";
import { ensureProjectRoot, getProjectRoot } from "../project-core/project-root";
import { beginProjectOperation, isProjectDirectoryMigrating } from "../project-core/project-activity";

const PROJECT_ASSET_SCHEME = "robot-project";
const PROJECT_ASSET_HOST = "asset";

const contentTypes: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".bin": "application/octet-stream",
};

export function configureProjectAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PROJECT_ASSET_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

function responseHeaders(filePath: string, size: number): Headers {
  return new Headers({
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache",
    "Content-Length": String(size),
    "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
  });
}

function parseRange(rangeHeader: string | null, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader || "");
  if (!match || (!match[1] && !match[2])) return null;

  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[2] && match[1] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
  start = Math.max(0, start);
  end = Math.min(size - 1, end);
  if (start > end || start >= size) return null;
  return { start, end };
}

function resolveRequestPath(requestUrl: string): string {
  ensureProjectRoot();
  const url = new URL(requestUrl);
  if (url.hostname !== PROJECT_ASSET_HOST) throw new Error("项目资源地址无效");

  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  const projectRoot = getProjectRoot();
  return assertInside(projectRoot, path.resolve(projectRoot, ...segments), "读取项目资源");
}

export function createProjectAssetUrl(filePath: string): string {
  ensureProjectRoot();
  const projectRoot = getProjectRoot();
  const safePath = assertInside(projectRoot, filePath, "读取项目资源");
  const relativePath = path.relative(projectRoot, safePath);
  const encodedPath = relativePath.split(path.sep).map(encodeURIComponent).join("/");
  return `${PROJECT_ASSET_SCHEME}://${PROJECT_ASSET_HOST}/${encodedPath}`;
}

export function registerProjectAssetProtocol(): void {
  protocol.handle(PROJECT_ASSET_SCHEME, async (request) => {
    if (isProjectDirectoryMigrating()) return new Response("Migrating", { status: 503 });
    const release = beginProjectOperation("项目资源流");
    let streaming = false;
    const bodyFor = (filePath: string, range?: { start: number; end: number }) => {
      const stream = fs.createReadStream(filePath, range);
      stream.once("close", release);
      streaming = true;
      return Readable.toWeb(stream);
    };
    try {
      const filePath = resolveRequestPath(request.url);
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) return new Response("Not Found", { status: 404 });

      const headers = responseHeaders(filePath, stat.size);
      const range = parseRange(request.headers.get("range"), stat.size);
      if (request.method === "HEAD") return new Response(null, { status: 200, headers });

      if (range) {
        const length = range.end - range.start + 1;
        headers.set("Content-Length", String(length));
        headers.set("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
        const body = bodyFor(filePath, range);
        return new Response(body as BodyInit, { status: 206, headers });
      }

      const body = bodyFor(filePath);
      return new Response(body as BodyInit, { status: 200, headers });
    } catch (error) {
      console.error("[project-asset] request failed", error);
      return new Response("Not Found", { status: 404 });
    } finally {
      if (!streaming) release();
    }
  });
}
