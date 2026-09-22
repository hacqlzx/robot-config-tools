import { ipcMain, net } from "electron";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

export function registerFileIpc(): void {
  ipcMain.handle("read-file-chunk", async (_event, filePath: string, offset: number, length: number) => {
    const fd = await fs.promises.open(filePath, "r");
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fd.read(buf, 0, length, offset);
      return buf.buffer.slice(0, bytesRead);
    } finally {
      await fd.close();
    }
  });

  ipcMain.handle("read-large-file", async (_event, filePath: string) => {
    const { size } = await fs.promises.stat(filePath);
    if (size < 2 * 1024 * 1024 * 1024) {
      const buffer = await fs.promises.readFile(filePath);
      return buffer.buffer;
    }

    const fd = await fs.promises.open(filePath, "r");
    try {
      const buf = Buffer.allocUnsafe(size);
      let offset = 0;
      const chunkSize = 512 * 1024 * 1024;
      while (offset < size) {
        const toRead = Math.min(chunkSize, size - offset);
        const { bytesRead } = await fd.read(buf, offset, toRead, offset);
        offset += bytesRead;
      }
      return buf.buffer;
    } finally {
      await fd.close();
    }
  });

  /**
   * 将后台文件直接流式写入已选择的目标目录。
   * 下载不再借用项目目录作为临时中转，避免未选择项目时流程被提前中断。
   */
  ipcMain.handle("download-remote-file", async (
    _event,
    remoteUrl: string,
    preferredFileName: string,
    destDir: string,
  ) => {
    let tempPath = "";
    try {
      const url = new URL(String(remoteUrl || "").trim());
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("下载地址无效");
      }

      const outputDir = path.resolve(String(destDir || "").trim());
      const stat = await fs.promises.stat(outputDir);
      if (!stat.isDirectory()) throw new Error("保存目录无效");

      const fileName = uniqueDownloadFileName(outputDir, normalizeDownloadFileName(preferredFileName));
      const filePath = path.join(outputDir, fileName);
      tempPath = `${filePath}.download-${process.pid}-${Date.now()}`;

      const response = await fetchRemoteFile(url.toString());
      if (!response.ok) throw new Error(`下载失败（${response.status}）`);
      if (!response.body) throw new Error("下载内容为空");

      await pipeline(
        Readable.fromWeb(response.body as any),
        fs.createWriteStream(tempPath),
      );
      await fs.promises.rename(tempPath, filePath);
      tempPath = "";

      return { success: true, filePath, fileName };
    } catch (error: any) {
      if (tempPath) {
        await fs.promises.rm(tempPath, { force: true }).catch((): undefined => undefined);
      }
      console.error("[download-remote-file] 下载失败:", error?.message || error);
      return { success: false, error: error?.message || "下载失败" };
    }
  });
}

async function fetchRemoteFile(url: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const requestId = Date.now().toString() + Math.random().toString(36).slice(2, 8);
    const startedAt = Date.now();
    console.info("[后台请求][主进程] 开始", { label: "远程文件下载", requestId, url, attempt: attempt + 1 });
    try {
      const response = await net.fetch(url, {
        credentials: "include",
        headers: { "req-id": requestId, Accept: "*/*" },
      });
      console.info("[后台请求][主进程] 完成", {
        label: "远程文件下载",
        requestId,
        status: response.status,
        elapsedMs: Date.now() - startedAt,
      });
      return response;
    } catch (error) {
      lastError = error;
      console.warn("[后台请求][主进程] 失败", {
        label: "远程文件下载",
        requestId,
        elapsedMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      });
      if (attempt > 0) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("下载失败");
}

function normalizeDownloadFileName(value: string): string {
  const baseName = path.basename(String(value || "").trim())
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/[. ]+$/g, "");
  return baseName || "download.bin";
}

function uniqueDownloadFileName(dir: string, preferredName: string): string {
  const parsed = path.parse(preferredName);
  let candidate = preferredName;
  let index = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${parsed.name}_${index}${parsed.ext}`;
    index += 1;
  }
  return candidate;
}
