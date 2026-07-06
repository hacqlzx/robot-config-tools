import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { assertInside, resolveProjectDir, toProjectRelativePath } from "./project-paths";

export const SUPPORTED_MAP_EXTS = new Set([".las", ".laz"]);
export const POINT_TABLE_EXTS = new Set([".xls", ".xlsx"]);
export const PROJECT_MANIFEST_FILE = "project.manifest.json";
const PROJECT_MANIFEST_SCHEMA_VERSION = 1;
const PROJECT_LAYOUT_VERSION = 1;
const DEFAULT_PROJECT_DIRS = {
  maps: "地图",
  pointTables: "点表",
  surveyImages: "勘察图",
};

export interface ProjectManifestAsset {
  id: string;
  name: string;
  relativePath: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface ProjectManifest {
  schemaVersion: number;
  project: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  };
  layout: {
    version: number;
    dirs: {
      maps: string;
      pointTables: string;
      surveyImages: string;
      [key: string]: string;
    };
  };
  assets: {
    maps: ProjectManifestAsset[];
    pointTables: ProjectManifestAsset[];
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

function normalizeManifest(projectName: string, raw: any): ProjectManifest {
  const defaults = createDefaultManifest(projectName);
  const project = raw?.project && typeof raw.project === "object" ? raw.project : {};
  const layout = raw?.layout && typeof raw.layout === "object" ? raw.layout : {};
  const dirs = layout.dirs && typeof layout.dirs === "object" ? layout.dirs : {};
  const assets = raw?.assets && typeof raw.assets === "object" ? raw.assets : {};

  return {
    schemaVersion: PROJECT_MANIFEST_SCHEMA_VERSION,
    project: {
      id: typeof project.id === "string" && project.id ? project.id : defaults.project.id,
      name: projectName,
      createdAt: typeof project.createdAt === "string" ? project.createdAt : defaults.project.createdAt,
      updatedAt: typeof project.updatedAt === "string" ? project.updatedAt : defaults.project.updatedAt,
    },
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

export function writeProjectManifestByDir(projectDir: string, manifest: ProjectManifest): ProjectManifest {
  const filePath = manifestPath(projectDir);
  fs.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  return manifest;
}

export function ensureProjectManifest(projectName: string): ProjectManifest {
  const projectDir = resolveProjectDir(projectName);
  const manifest = readProjectManifestByDir(projectDir, projectName);
  return writeProjectManifestByDir(projectDir, manifest);
}

function updateProjectManifest(projectName: string, mutate: (manifest: ProjectManifest, projectDir: string) => void): ProjectManifest {
  const projectDir = resolveProjectDir(projectName);
  const manifest = readProjectManifestByDir(projectDir, projectName);
  mutate(manifest, projectDir);
  manifest.project.name = projectName;
  manifest.project.updatedAt = nowIso();
  return writeProjectManifestByDir(projectDir, manifest);
}

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
    return;
  }

  if (existing) {
    existing.updatedAt = nowIso();
  }
}

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
}
