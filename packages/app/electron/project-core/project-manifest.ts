import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { assertInside, resolveProjectDir, toProjectRelativePath } from "./project-paths";

export const SUPPORTED_MAP_EXTS = new Set([".las", ".laz"]);
export const POINT_TABLE_EXTS = new Set([".xls", ".xlsx"]);
export const PROJECT_MANIFEST_FILE = "project.manifest.json";
const PROJECT_MANIFEST_SCHEMA_VERSION = 2;
const PROJECT_LAYOUT_VERSION = 1;
/** 项目内约定目录名称，业务代码不直接写死字符串时优先从 manifest 读取。 */
const DEFAULT_PROJECT_DIRS = {
  maps: "地图",
  pointTables: "点表",
  surveyImages: "勘察数据",
};

export interface ProjectManifestAsset {
  /** 资产唯一 ID，用于后续重命名/移动时保持关联 */
  id: string;
  /** 展示名称，例如地图名或点表文件名 */
  name: string;
  /** 相对项目根目录的 POSIX 路径 */
  relativePath: string;
  /** 首次登记时间 */
  createdAt: string;
  /** 最近更新时间 */
  updatedAt: string;
  /** Potree 转换状态，主要供空间编辑显示模型缓存情况 */
  potree?: ProjectMapPotreeState;
  [key: string]: unknown;
}

export type ProjectMapPotreeStatus =
  | "missing"
  | "checking"
  | "converting"
  | "validating"
  | "ready"
  | "stale"
  | "error";

export interface ProjectMapPotreeState {
  status: ProjectMapPotreeStatus;
  outputRelativePath: string;
  metadataRelativePath: string;
  updatedAt: string;
  generatedAt?: string;
  error?: string;
  sourceSize?: number;
  sourceMtimeMs?: number;
}

export interface ProjectManifest {
  /** manifest schema 版本，用于后续兼容迁移 */
  schemaVersion: number;
  project: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  };
  database?: {
    path: string;
    formatVersion: number;
    migrationBatchId?: string | null;
    sourceFingerprint?: string | null;
  };
  layout: {
    /** 项目目录布局版本 */
    version: number;
    dirs: {
      maps: string;
      pointTables: string;
      surveyImages: string;
      [key: string]: string;
    };
  };
  assets: {
    /** 空间模型地图资产 */
    maps: ProjectManifestAsset[];
    /** 点表 Excel 资产 */
    pointTables: ProjectManifestAsset[];
    /** 勘察任务资产，当前仍在逐步接入 */
    surveyTasks: ProjectManifestAsset[];
  };
}

type ManifestAssetCollection = keyof ProjectManifest["assets"];

interface ManifestAssetInput {
  id?: string;
  name: string;
  relativePath: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function manifestPath(projectDir: string): string {
  return path.join(projectDir, PROJECT_MANIFEST_FILE);
}

function sanitizeAssetList(value: unknown): ProjectManifestAsset[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => {
      const stamp = nowIso();
      return {
        ...item,
        id: typeof item.id === "string" && item.id ? item.id : randomUUID(),
        name: typeof item.name === "string" ? item.name : "",
        relativePath: typeof item.relativePath === "string" ? item.relativePath.replace(/\\/g, "/") : "",
        createdAt: typeof item.createdAt === "string" ? item.createdAt : stamp,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : stamp,
      };
    })
    .filter((item) => item.name && item.relativePath);
}

/**
 * 新项目或旧项目缺失 manifest 时生成默认结构。
 */
export function createDefaultManifest(projectName: string): ProjectManifest {
  const stamp = nowIso();
  return {
    schemaVersion: PROJECT_MANIFEST_SCHEMA_VERSION,
    project: {
      id: randomUUID(),
      name: projectName,
      createdAt: stamp,
      updatedAt: stamp,
    },
    layout: {
      version: PROJECT_LAYOUT_VERSION,
      dirs: { ...DEFAULT_PROJECT_DIRS },
    },
    assets: {
      maps: [],
      pointTables: [],
      surveyTasks: [],
    },
  };
}

/**
 * 兼容旧版/损坏 manifest：缺字段时回填默认布局和空资产列表。
 */
function normalizeManifest(projectName: string, raw: any): ProjectManifest {
  const defaults = createDefaultManifest(projectName);
  const project = raw?.project && typeof raw.project === "object" ? raw.project : {};
  const layout = raw?.layout && typeof raw.layout === "object" ? raw.layout : {};
  const dirs = layout.dirs && typeof layout.dirs === "object" ? layout.dirs : {};
  const assets = raw?.assets && typeof raw.assets === "object" ? raw.assets : {};

  const database = raw?.database && typeof raw.database === "object" ? raw.database : null;
  return {
    schemaVersion: PROJECT_MANIFEST_SCHEMA_VERSION,
    project: {
      id: typeof project.id === "string" && project.id ? project.id : defaults.project.id,
      name: projectName,
      createdAt: typeof project.createdAt === "string" ? project.createdAt : defaults.project.createdAt,
      updatedAt: typeof project.updatedAt === "string" ? project.updatedAt : defaults.project.updatedAt,
    },
    ...(typeof database?.path === "string" && path.isAbsolute(database.path) === false
      ? {
          database: {
            path: database.path.replace(/\\/g, "/"),
            formatVersion: Number(database.formatVersion) || 1,
            migrationBatchId: typeof database.migrationBatchId === "string" ? database.migrationBatchId : null,
            sourceFingerprint: typeof database.sourceFingerprint === "string" ? database.sourceFingerprint : null,
          },
        }
      : {}),
    layout: {
      version: typeof layout.version === "number" ? layout.version : PROJECT_LAYOUT_VERSION,
      dirs: {
        ...DEFAULT_PROJECT_DIRS,
        ...Object.fromEntries(
          Object.entries(dirs).filter((entry): entry is [string, string] => typeof entry[1] === "string" && !!entry[1]),
        ),
      },
    },
    assets: {
      maps: sanitizeAssetList(assets.maps),
      pointTables: sanitizeAssetList(assets.pointTables),
      surveyTasks: sanitizeAssetList(assets.surveyTasks),
    },
  };
}

function readProjectManifestByDir(projectDir: string, projectName: string): ProjectManifest {
  const filePath = manifestPath(projectDir);
  if (!fs.existsSync(filePath)) {
    return createDefaultManifest(projectName);
  }

  try {
    return normalizeManifest(projectName, JSON.parse(fs.readFileSync(filePath, "utf-8")));
  } catch {
    return createDefaultManifest(projectName);
  }
}

/** Strict manifest read for database migration, where malformed identity must not be silently replaced. */
export function readProjectManifestForMigration(projectDir: string, projectName: string): ProjectManifest {
  const filePath = manifestPath(projectDir);
  if (!fs.existsSync(filePath)) return createDefaultManifest(projectName);
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("项目清单根节点无效");
    if (raw.database) {
      if (typeof raw.project?.id !== "string" || !raw.project.id.trim()) throw new Error("项目数据库清单缺少稳定项目 ID");
      if (typeof raw.database.path !== "string" || !raw.database.path.trim() || path.isAbsolute(raw.database.path)) {
        throw new Error("项目数据库路径必须是非空相对路径");
      }
      if (Number(raw.database.formatVersion) !== 1) throw new Error("项目数据库存储版本不受支持");
    }
    return normalizeManifest(projectName, raw);
  } catch (error) {
    throw new Error(`项目清单无法用于数据库迁移：${filePath}；${error instanceof Error ? error.message : String(error)}`);
  }
}

export function writeProjectManifestByDir(projectDir: string, manifest: ProjectManifest): ProjectManifest {
  const filePath = manifestPath(projectDir);
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf-8", flag: "wx" });
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }); } catch { /* preserve the original write error */ }
    throw error;
  }
  return manifest;
}

/**
 * 确保项目目录下存在 project.manifest.json，并返回规范化后的内容。
 */
export function ensureProjectManifest(projectName: string): ProjectManifest {
  const projectDir = resolveProjectDir(projectName);
  const manifest = readProjectManifestByDir(projectDir, projectName);
  return writeProjectManifestByDir(projectDir, manifest);
}

/**
 * 统一的 manifest 读改写入口。
 */
function updateProjectManifest(projectName: string, mutate: (manifest: ProjectManifest, projectDir: string) => void): ProjectManifest {
  const projectDir = resolveProjectDir(projectName);
  const manifest = readProjectManifestByDir(projectDir, projectName);
  mutate(manifest, projectDir);
  manifest.project.name = projectName;
  manifest.project.updatedAt = nowIso();
  return writeProjectManifestByDir(projectDir, manifest);
}

export function updateProjectDatabaseMetadata(
  projectName: string,
  database: NonNullable<ProjectManifest["database"]>,
): ProjectManifest {
  return updateProjectManifest(projectName, (manifest) => { manifest.database = database; });
}

/**
 * 按相对路径或名称更新资产；已有资产保留 createdAt，只刷新 updatedAt。
 */
function upsertManifestAsset(
  manifest: ProjectManifest,
  collection: ManifestAssetCollection,
  asset: ManifestAssetInput,
): void {
  const normalizedPath = asset.relativePath.replace(/\\/g, "/");
  const list = manifest.assets[collection];
  const existing = list.find((item) => item.relativePath === normalizedPath || item.name === asset.name);
  const stamp = nowIso();
  const next: ProjectManifestAsset = {
    ...asset,
    id: existing?.id || asset.id || randomUUID(),
    name: asset.name,
    relativePath: normalizedPath,
    createdAt: existing?.createdAt || asset.createdAt || stamp,
    updatedAt: stamp,
  };

  if (existing) {
    Object.assign(existing, next);
  } else {
    list.push(next);
  }
}

function mapAssetBySourcePath(manifest: ProjectManifest, relativePath: string): ProjectManifestAsset | undefined {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const mapDir = manifest.layout.dirs.maps;
  const parts = normalizedPath.split("/");
  if (parts[0] !== mapDir || !parts[1]) return undefined;
  const mapRelativePath = `${mapDir}/${parts[1]}`;
  return manifest.assets.maps.find((item) => item.relativePath === mapRelativePath || item.entryFile === normalizedPath);
}

/**
 * 根据项目内写入路径维护地图资产。
 */
function touchMapAssetForPath(manifest: ProjectManifest, relativePath: string): void {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const mapDir = manifest.layout.dirs.maps;
  const parts = normalizedPath.split("/");
  if (parts[0] !== mapDir || !parts[1]) return;

  const mapName = parts[1];
  const mapRelativePath = `${mapDir}/${mapName}`;
  const ext = path.posix.extname(normalizedPath).toLowerCase();
  const existing = manifest.assets.maps.find((item) => item.relativePath === mapRelativePath);
  if (!existing && !SUPPORTED_MAP_EXTS.has(ext)) return;

  if (SUPPORTED_MAP_EXTS.has(ext)) {
    upsertManifestAsset(manifest, "maps", {
      name: mapName,
      relativePath: mapRelativePath,
      entryFile: normalizedPath,
      ext,
      type: "pointCloud",
    });
    const asset = manifest.assets.maps.find((item) => item.relativePath === mapRelativePath || item.entryFile === normalizedPath);
    if (asset?.potree) {
      asset.potree = {
        ...asset.potree,
        status: "stale",
        error: undefined,
        updatedAt: nowIso(),
      };
      asset.updatedAt = nowIso();
    }
    return;
  }

  if (existing) {
    existing.updatedAt = nowIso();
  }
}

/**
 * 根据项目内写入路径维护点表资产。
 */
function touchPointTableAssetForPath(manifest: ProjectManifest, relativePath: string, fileSize?: number): void {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const pointTableDir = manifest.layout.dirs.pointTables;
  const parts = normalizedPath.split("/");
  const ext = path.posix.extname(normalizedPath).toLowerCase();
  if (parts[0] !== pointTableDir || parts.length !== 2 || !POINT_TABLE_EXTS.has(ext)) return;

  upsertManifestAsset(manifest, "pointTables", {
    name: path.posix.basename(normalizedPath, ext),
    relativePath: normalizedPath,
    ext,
    fileSize,
    type: "excel",
  });
}

export function updateManifestForProjectRename(projectName: string): ProjectManifest {
  return updateProjectManifest(projectName, (manifest) => {
    manifest.project.name = projectName;
  });
}

export function updateManifestForWrittenFile(projectName: string, filePath: string, fileSize?: number): void {
  updateProjectManifest(projectName, (manifest, projectDir) => {
    const relativePath = toProjectRelativePath(projectDir, filePath);
    touchMapAssetForPath(manifest, relativePath);
    touchPointTableAssetForPath(manifest, relativePath, fileSize);
  });
}

export function updateManifestForPotreeModel(
  projectName: string,
  params: {
    modelPath: string;
    outputDir: string;
    metadataPath?: string;
    status: ProjectMapPotreeStatus;
    generated?: boolean;
    error?: string;
  },
): void {
  updateProjectManifest(projectName, (manifest, projectDir) => {
    const safeModelPath = assertInside(projectDir, params.modelPath, "更新 Potree 清单");
    const safeOutputDir = assertInside(projectDir, params.outputDir, "更新 Potree 清单");
    const safeMetadataPath = params.metadataPath
      ? assertInside(projectDir, params.metadataPath, "更新 Potree 清单")
      : path.join(safeOutputDir, "metadata.json");
    const relativeModelPath = toProjectRelativePath(projectDir, safeModelPath).replace(/\\/g, "/");
    const relativeOutputDir = toProjectRelativePath(projectDir, safeOutputDir).replace(/\\/g, "/");
    const relativeMetadataPath = toProjectRelativePath(projectDir, safeMetadataPath).replace(/\\/g, "/");
    touchMapAssetForPath(manifest, relativeModelPath);
    const asset = mapAssetBySourcePath(manifest, relativeModelPath);
    if (!asset) return;

    const sourceStat = fs.existsSync(safeModelPath) ? fs.statSync(safeModelPath) : null;
    const stamp = nowIso();
    asset.potree = {
      status: params.status,
      outputRelativePath: relativeOutputDir,
      metadataRelativePath: relativeMetadataPath,
      updatedAt: stamp,
      generatedAt: params.generated ? stamp : asset.potree?.generatedAt,
      error: params.error || undefined,
      sourceSize: sourceStat?.size,
      sourceMtimeMs: sourceStat?.mtimeMs,
    };
    asset.updatedAt = stamp;
  });
}

export function removeManifestAssetsUnderPath(projectName: string, targetPath: string): void {
  updateProjectManifest(projectName, (manifest, projectDir) => {
    const relativePath = toProjectRelativePath(projectDir, targetPath);
    const isAffected = (value: unknown) => {
      if (typeof value !== "string") return false;
      return value === relativePath || value.startsWith(`${relativePath}/`);
    };

    for (const key of Object.keys(manifest.assets) as ManifestAssetCollection[]) {
      manifest.assets[key] = manifest.assets[key].filter((asset) =>
        !isAffected(asset.relativePath) && !isAffected(asset.entryFile),
      );
    }
  });
}

export function rewriteManifestAssetPathsAfterMove(projectName: string, oldPath: string, newPath: string): void {
  updateProjectManifest(projectName, (manifest, projectDir) => {
    const oldRelativePath = toProjectRelativePath(projectDir, oldPath);
    const newRelativePath = toProjectRelativePath(projectDir, newPath);
    const rewrite = (value: unknown) => {
      if (typeof value !== "string") return value;
      if (value === oldRelativePath) return newRelativePath;
      if (value.startsWith(`${oldRelativePath}/`)) return `${newRelativePath}${value.slice(oldRelativePath.length)}`;
      return value;
    };

    for (const key of Object.keys(manifest.assets) as ManifestAssetCollection[]) {
      for (const asset of manifest.assets[key]) {
        asset.relativePath = String(rewrite(asset.relativePath));
        if (typeof asset.entryFile === "string") {
          asset.entryFile = rewrite(asset.entryFile);
        }
        asset.updatedAt = nowIso();
        if (key === "maps" && asset.potree) {
          asset.potree = {
            ...asset.potree,
            outputRelativePath: `${asset.relativePath}/.potree`,
            metadataRelativePath: `${asset.relativePath}/.potree/metadata.json`,
            updatedAt: nowIso(),
          };
        }
        if (key === "maps") {
          asset.name = asset.relativePath.split("/")[1] || asset.name;
        } else if (key === "pointTables") {
          const ext = path.posix.extname(asset.relativePath);
          asset.name = path.posix.basename(asset.relativePath, ext) || asset.name;
        }
      }
    }
  });
}

export function assertWritableProjectFile(projectName: string, filePath: string): void {
  const projectDir = resolveProjectDir(projectName);
  const resolved = assertInside(projectDir, filePath, "写入项目文件");
  if (path.basename(resolved) === PROJECT_MANIFEST_FILE && path.dirname(resolved) === projectDir) {
    throw new Error("项目清单由主进程维护，禁止直接写入");
  }
  assertProjectDatabasePathUnchanged(projectName, resolved);
}

/** 项目库及所在目录只能由数据库/项目生命周期入口维护。 */
export function assertProjectDatabasePathUnchanged(projectName: string, targetPath: string): void {
  const projectDir = resolveProjectDir(projectName);
  const manifest = readProjectManifestForMigration(projectDir, projectName);
  const databasePath = path.resolve(projectDir, manifest.database?.path || "database/robot-config.db");
  const target = path.resolve(targetPath);
  const relative = path.relative(target, databasePath);
  const databaseDirectory = path.dirname(databasePath);
  const insideDirectory = path.relative(databaseDirectory, target);
  if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))
    || !insideDirectory || (!insideDirectory.startsWith("..") && !path.isAbsolute(insideDirectory))) {
    throw new Error("项目数据库由主进程维护，禁止直接修改数据库文件或目录");
  }
}
