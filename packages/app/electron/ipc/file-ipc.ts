import { registerProjectActivityHandler } from "../project-core/project-activity";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { buildBackendResponseError, requestBackendResource } from "../backend-http";

export function registerFileIpc(): void {
  registerProjectActivityHandler("read-file-chunk", async (_event, filePath: string, offset: number, length: number) => {
    const fd = await fs.promises.open(filePath, "r");
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fd.read(buf, 0, length, offset);
      return buf.buffer.slice(0, bytesRead);
    } finally {
      await fd.close();
    }
  });

  registerProjectActivityHandler("read-large-file", async (_event, filePath: string) => {
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
  registerProjectActivityHandler("download-remote-file", async (
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

      const response = await requestBackendResource(url.toString(), {
        responseType: "stream",
      }, "远程文件下载");
      if (response.status < 200 || response.status >= 300) {
        throw new Error(await buildBackendResponseError(response, "下载失败"));
      }
      if (!response.data) throw new Error("下载内容为空");

      await pipeline(
        response.data,
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
