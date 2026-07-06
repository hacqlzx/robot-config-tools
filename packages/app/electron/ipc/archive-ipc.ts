import { ipcMain } from "electron";
import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";

export function registerArchiveIpc(): void {
  ipcMain.handle("extract-zip", async (_event, zipPath: string, destDir: string) => {
    console.log("[extract-zip] 开始解压:", zipPath, "→", destDir);
    try {
      const zip = new AdmZip(zipPath);
      const entries = zip.getEntries();
      console.log(`[extract-zip] 共 ${entries.length} 个条目, 前5:`, entries.slice(0, 5).map((e: any) => e.entryName));
      zip.extractAllTo(destDir, true);
      console.log("[extract-zip] 解压完成:", destDir);

      const topItems = fs.readdirSync(destDir, { withFileTypes: true });
      console.log(`[extract-zip] 顶层条目: ${topItems.map((x) => `${x.name}(${x.isDirectory() ? "d" : "f"})`).join(", ")}`);

      const subDirs = topItems.filter((x) => x.isDirectory() && !x.name.startsWith(".") && !x.name.startsWith("__"));
      for (const d of subDirs) {
        const candidate = path.join(destDir, d.name);
        if (fs.existsSync(path.join(candidate, "json_list.json"))) {
          const subItems = fs.readdirSync(candidate, { withFileTypes: true });
          for (const item of subItems) {
            const src = path.join(candidate, item.name);
            const dst = path.join(destDir, item.name);
            if (item.isDirectory() && fs.existsSync(dst)) {
              cpMerge(src, dst);
            } else {
              fs.cpSync(src, dst, { recursive: true, force: true });
            }
          }
          fs.rmSync(candidate, { recursive: true, force: true });
          console.log("[extract-zip] 扁平化目录，去除嵌套 →", candidate);
        }
      }
      return { success: true, actualDir: destDir };
    } catch (e: any) {
      console.error("[extract-zip] 解压失败:", e.message);
      return { success: false, error: e.message };
    }
  });
}

function cpMerge(src: string, dst: string): void {
  const items = fs.readdirSync(src, { withFileTypes: true });
  for (const item of items) {
    const s = path.join(src, item.name);
    const d = path.join(dst, item.name);
    if (item.isDirectory()) {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      cpMerge(s, d);
    } else {
      fs.cpSync(s, d, { force: true });
    }
  }
}
