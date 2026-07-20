import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { ipcMain } from "electron";
import AdmZip from "adm-zip";
import * as XLSX from "xlsx";
import { isPathInside, resolveProjectDir, resolveProjectPath } from "../project-core/project-paths";

type DeviceVerificationNodeKind = "region" | "bay" | "mainDevice" | "component" | "point";
type DeviceVerificationSourceType = "zip" | "directory";

interface DeviceVerificationNodeRecord {
  id: string;
  title: string;
  code: string;
  kind: DeviceVerificationNodeKind;
  parentId: string | null;
  childrenIds: string[];
  imagePath?: string;
  imageMime?: string;
}

interface DeviceVerificationSession {
  id: string;
  sourceDir: string;
  packageName: string;
  nodes: Map<string, DeviceVerificationNodeRecord>;
  rootIds: string[];
}

interface ImageEntryInfo {
  filePath: string;
  mime: string;
}

interface DeviceVerificationSource {
  path: string;
  type: DeviceVerificationSourceType;
}

const OVERVIEW_DIR_NAME = "总览图";
const DEVICE_VERIFY_DIR_NAME = "设备验证图";

const hierarchyColumns: Array<{
  kind: DeviceVerificationNodeKind;
  names: string[];
  codes: string[];
}> = [
  { kind: "region", names: ["*区域", "区域"], codes: ["区域编码"] },
  { kind: "bay", names: ["*间隔名称", "间隔名称"], codes: ["间隔编码"] },
  { kind: "mainDevice", names: ["*主设备名称", "主设备名称"], codes: ["主设备编码"] },
  { kind: "component", names: ["*部件名称", "部件名称"], codes: ["部件编码"] },
  { kind: "point", names: ["*点位名称", "点位名称"], codes: ["点位编码"] },
];

let activeSession: DeviceVerificationSession | null = null;

export function registerDeviceVerifyIpc(): void {
  ipcMain.handle("device-verify:import-package", async (_event, projectName: string, sourcePath: string) => {
    try {
      const source = validatePackageSource(sourcePath);
      const importDir = importDeviceVerificationSource(projectName, source);
      const session = readDeviceVerificationDirectory(importDir, path.basename(source.path));
      activeSession = session;

      return buildPackageResult(session);
    } catch (error: any) {
      console.error("[device-verify] 导入设备验证图失败:", error?.message || error);
      return { success: false, error: error?.message || "设备验证图加载失败" };
    }
  });

  ipcMain.handle("device-verify:load-local", async (_event, projectName: string) => {
    try {
      const localDir = getDeviceVerificationDir(projectName);
      if (!fs.existsSync(localDir) || !fs.statSync(localDir).isDirectory()) {
        return { success: true, hasData: false };
      }

      const session = readDeviceVerificationDirectory(localDir, DEVICE_VERIFY_DIR_NAME);
      activeSession = session;
      return buildPackageResult(session);
    } catch (error: any) {
      console.error("[device-verify] 加载本地设备验证图失败:", error?.message || error);
      return { success: false, error: error?.message || "本地设备验证图加载失败" };
    }
  });

  ipcMain.handle("device-verify:list-children", async (_event, sessionId: string, parentId: string) => {
    try {
      const session = getActiveSession(sessionId);
      const parent = session.nodes.get(String(parentId || ""));
      if (!parent) throw new Error("树节点不存在，请重新加载设备验证图");
      return {
        success: true,
        children: parent.childrenIds.map((id) => toPublicNode(session, session.nodes.get(id)!, false)),
      };
    } catch (error: any) {
      return { success: false, error: error?.message || "点位树加载失败" };
    }
  });

  ipcMain.handle("device-verify:load-image", async (_event, sessionId: string, pointNodeId: string) => {
    try {
      const session = getActiveSession(sessionId);
      const point = session.nodes.get(String(pointNodeId || ""));
      if (!point || point.kind !== "point") throw new Error("请选择点位节点");
      if (!point.imagePath || !point.imageMime) throw new Error("该点位没有对应图片");

      const imagePath = path.resolve(point.imagePath);
      if (!isPathInside(session.sourceDir, imagePath)) throw new Error("图片路径越界，请重新加载设备验证图");
      if (!fs.existsSync(imagePath) || !fs.statSync(imagePath).isFile()) throw new Error("未找到点位图片，请重新加载设备验证图");

      return {
        success: true,
        fileName: path.basename(imagePath),
        dataUrl: `data:${point.imageMime};base64,${fs.readFileSync(imagePath).toString("base64")}`,
      };
    } catch (error: any) {
      console.error("[device-verify] 加载点位图片失败:", error?.message || error);
      return { success: false, error: error?.message || "点位图片加载失败" };
    }
  });
}

function importDeviceVerificationSource(projectName: string, source: DeviceVerificationSource): string {
  const safeProjectName = String(projectName || "").trim();
  if (!safeProjectName) throw new Error("请先选择项目");

  const projectDir = resolveProjectDir(safeProjectName);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    throw new Error(`项目 "${safeProjectName}" 不存在`);
  }

  const targetDir = getDeviceVerificationDir(safeProjectName);
  if (source.type === "directory") {
    assertDirectoryDoesNotOverlap(source.path, targetDir);
  }

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });

  if (source.type === "zip") {
    extractZipToDir(source.path, targetDir);
  } else {
    fs.cpSync(source.path, targetDir, { recursive: true, force: true });
  }

  flattenSingleWrapperDir(targetDir);
  return targetDir;
}

function getDeviceVerificationDir(projectName: string): string {
  return resolveProjectPath(projectName, OVERVIEW_DIR_NAME, DEVICE_VERIFY_DIR_NAME);
}

function buildPackageResult(session: DeviceVerificationSession) {
  const nodes = [...session.nodes.values()];
  const pointNodes = nodes.filter((node) => node.kind === "point");
  const matchedImageCount = pointNodes.filter((node) => node.imagePath).length;
  return {
    success: true,
    hasData: true,
    sessionId: session.id,
    packageName: session.packageName,
    localDir: session.sourceDir,
    roots: session.rootIds.map((id) => toPublicNode(session, session.nodes.get(id)!, true)),
    expandedKeys: collectExpandedKeys(session),
    pointCount: pointNodes.length,
    imageCount: matchedImageCount,
  };
}

function readDeviceVerificationDirectory(sourceDir: string, packageName: string): DeviceVerificationSession {
  const files = collectFiles(sourceDir);
  const workbookPath = findPointWorkbookPath(files);
  if (!workbookPath) throw new Error("未找到点表.xlsx");

  const imageByPointCode = new Map<string, ImageEntryInfo>();
  for (const filePath of files) {
    const relativePath = path.relative(sourceDir, filePath).replace(/\\/g, "/");
    const segments = relativePath.split("/").filter(Boolean);
    if (!segments.slice(0, -1).some((segment) => segment.toLowerCase() === "img")) continue;

    const ext = path.extname(filePath).toLowerCase();
    const mime = imageMimeType(ext);
    if (!mime) continue;
    const pointCode = path.basename(filePath, ext).trim();
    if (!pointCode) continue;
    imageByPointCode.set(pointCode.toLowerCase(), { filePath, mime });
  }

  const { nodes, rootIds } = buildVerificationTree(fs.readFileSync(workbookPath), imageByPointCode);
  if (rootIds.length === 0) throw new Error("点表.xlsx 中未解析到有效的区域数据");

  return {
    id: randomUUID(),
    sourceDir,
    packageName,
    nodes,
    rootIds,
  };
}

function buildVerificationTree(
  workbookBuffer: Buffer,
  imageByPointCode: Map<string, ImageEntryInfo>,
): { nodes: Map<string, DeviceVerificationNodeRecord>; rootIds: string[] } {
  const workbook = XLSX.read(workbookBuffer, { type: "buffer" });
  const sheetName = workbook.SheetNames.find((name) => name.toLowerCase() === "sheet1") || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error("点表.xlsx 中没有可读取的工作表");

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];
  const headerIndex = findHeaderRowIndex(grid);
  if (headerIndex < 0) throw new Error("点表.xlsx 中未找到点位表头");

  const headers = grid[headerIndex].map(valueText);
  const nodes = new Map<string, DeviceVerificationNodeRecord>();
  const rootIds: string[] = [];
  const nodeByIdentity = new Map<string, string>();
  let sequence = 0;

  for (let rowIndex = headerIndex + 1; rowIndex < grid.length; rowIndex++) {
    const row = mapRow(headers, grid[rowIndex]);
    let parentId: string | null = null;

    for (const level of hierarchyColumns) {
      const title = firstValue(row, level.names);
      const code = firstValue(row, level.codes);
      if (!title && !code) break;

      const identityValue = code ? `code:${code}` : `name:${title}`;
      const identity = `${parentId || "root"}\u0000${level.kind}\u0000${identityValue}`;
      let nodeId = nodeByIdentity.get(identity);

      if (!nodeId) {
        nodeId = `device-verify:${level.kind}:${++sequence}`;
        const image = level.kind === "point" && code
          ? imageByPointCode.get(code.toLowerCase())
          : undefined;
        nodes.set(nodeId, {
          id: nodeId,
          title: title || code,
          code,
          kind: level.kind,
          parentId,
          childrenIds: [],
          imagePath: image?.filePath,
          imageMime: image?.mime,
        });
        nodeByIdentity.set(identity, nodeId);

        if (parentId) {
          nodes.get(parentId)!.childrenIds.push(nodeId);
        } else {
          rootIds.push(nodeId);
        }
      } else {
        const existing = nodes.get(nodeId)!;
        if (title && existing.title === existing.code) existing.title = title;
        if (level.kind === "point" && code && !existing.imagePath) {
          const image = imageByPointCode.get(code.toLowerCase());
          existing.imagePath = image?.filePath;
          existing.imageMime = image?.mime;
        }
      }

      parentId = nodeId;
    }
  }

  return { nodes, rootIds };
}

function findPointWorkbookPath(files: string[]): string | undefined {
  const workbooks = files.filter((filePath) => {
    const baseName = path.basename(filePath);
    return /\.xlsx$/i.test(baseName) && !baseName.startsWith("~$");
  });
  return workbooks.find((filePath) => path.basename(filePath) === "点表.xlsx") || workbooks[0];
}

function findHeaderRowIndex(grid: unknown[][]): number {
  return grid.slice(0, 10).findIndex((row) => {
    const headers = new Set(row.map(valueText));
    const hasPoint = headers.has("点位编码") || headers.has("点位名称") || headers.has("*点位名称");
    const hasRegion = headers.has("区域") || headers.has("*区域") || headers.has("区域编码");
    return hasPoint && hasRegion;
  });
}

function mapRow(headers: string[], values: unknown[]): Record<string, string> {
  const row: Record<string, string> = {};
  for (let index = 0; index < headers.length; index++) {
    const header = headers[index];
    if (header) row[header] = valueText(values[index]);
  }
  return row;
}

function firstValue(row: Record<string, string>, headers: string[]): string {
  for (const header of headers) {
    const value = valueText(row[header]);
    if (value) return value;
  }
  return "";
}

function toPublicNode(session: DeviceVerificationSession, node: DeviceVerificationNodeRecord, includeChildren: boolean) {
  return {
    key: node.id,
    title: node.title,
    code: node.code,
    kind: node.kind,
    isLeaf: node.childrenIds.length === 0,
    hasImage: Boolean(node.imagePath),
    ...(includeChildren && node.childrenIds.length > 0
      ? { children: node.childrenIds.map((id) => toPublicNode(session, session.nodes.get(id)!, true)) }
      : {}),
  };
}

function collectExpandedKeys(session: DeviceVerificationSession): string[] {
  const keys: string[] = [];
  const walk = (nodeId: string) => {
    const node = session.nodes.get(nodeId);
    if (!node) return;
    if (node.childrenIds.length > 0) keys.push(node.id);
    node.childrenIds.forEach(walk);
  };
  session.rootIds.forEach(walk);
  return keys;
}

function getActiveSession(sessionId: string): DeviceVerificationSession {
  if (!activeSession || activeSession.id !== String(sessionId || "")) {
    throw new Error("设备验证图已失效，请重新加载");
  }
  return activeSession;
}

function validatePackageSource(sourcePath: string): DeviceVerificationSource {
  const rawPath = String(sourcePath || "").trim();
  if (!rawPath) throw new Error("导入路径无效");
  const resolved = path.resolve(rawPath);
  if (!path.isAbsolute(resolved)) throw new Error("导入路径无效");
  if (!fs.existsSync(resolved)) throw new Error("导入路径不存在");

  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) return { path: resolved, type: "directory" };
  if (stat.isFile() && path.extname(resolved).toLowerCase() === ".zip") return { path: resolved, type: "zip" };
  throw new Error("请选择 ZIP 压缩包或设备验证图目录");
}

function assertDirectoryDoesNotOverlap(sourceDir: string, targetDir: string): void {
  const source = path.resolve(sourceDir);
  const target = path.resolve(targetDir);
  if (isPathInside(source, target) || isPathInside(target, source)) {
    throw new Error("导入目录不能是当前项目的设备验证图目录或其上级/子级目录");
  }
}

function extractZipToDir(zipPath: string, targetDir: string): void {
  const zip = new AdmZip(zipPath);
  for (const entry of zip.getEntries()) {
    const entryName = normalizeArchiveEntryName(entry.entryName);
    if (!entryName) continue;
    if (entryName.split("/").some((segment) => segment === ".." || /[<>:"|?*\x00-\x1F]/.test(segment))) {
      throw new Error(`压缩包包含非法路径：${entry.entryName}`);
    }
    const resolved = path.resolve(targetDir, entryName);
    if (!isPathInside(targetDir, resolved)) {
      throw new Error(`压缩包包含越界路径：${entry.entryName}`);
    }
  }
  zip.extractAllTo(targetDir, true);
}

function flattenSingleWrapperDir(dir: string): void {
  const items = fs.readdirSync(dir, { withFileTypes: true })
    .filter((item) => !item.name.startsWith(".") && item.name !== "__MACOSX");
  const directories = items.filter((item) => item.isDirectory());
  const files = items.filter((item) => item.isFile());
  if (files.length > 0 || directories.length !== 1) return;

  const wrapperDir = path.join(dir, directories[0].name);
  for (const item of fs.readdirSync(wrapperDir, { withFileTypes: true })) {
    const source = path.join(wrapperDir, item.name);
    const target = path.join(dir, item.name);
    fs.cpSync(source, target, { recursive: true, force: true });
  }
  fs.rmSync(wrapperDir, { recursive: true, force: true });
}

function collectFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(filePath));
    } else if (entry.isFile()) {
      files.push(filePath);
    }
  }
  return files;
}

function normalizeArchiveEntryName(entryName: string): string {
  return String(entryName || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .join("/");
}

function imageMimeType(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".gif":
      return "image/gif";
    default:
      return "";
  }
}

function valueText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}
