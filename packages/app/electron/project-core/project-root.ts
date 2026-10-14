import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  migrateProjectDirectory, readDirectoryMigrationJournal, writeMigrationJson,
  type DirectoryMigrationProgress, type DirectoryMigrationResult,
} from "./directory-migration";
import { beginProjectDirectoryMigration, notifyProjectRootChanged } from "./project-activity";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let PROJECT_ROOT = "";
const DEFAULT_PROJECT_FOLDER = "RobotConfigTools";
const DEFAULT_PROJECT_SUBFOLDER = "project";
const projectRootConfigPath = () => path.join(app.getPath("userData"), "data-path.json");
const migrationJournalPath = () => path.join(app.getPath("userData"), "data-path-migration.json");

function getPackagedProjectRoot(): string {
  // 业务数据不能放在安装目录：升级、卸载和 Program Files 权限都会影响它。
  // 使用 ASCII 目录名也能继续兼容 PotreeConverter 的路径限制。
  return path.join(app.getPath("documents"), DEFAULT_PROJECT_FOLDER, DEFAULT_PROJECT_SUBFOLDER);
}

function getLegacyPackagedProjectRoots(): string[] {
  const executableDir = path.dirname(app.getPath("exe"));
  // 兼容旧安装布局：新版可能安装到旧 app 目录的上一级。
  return [
    path.join(executableDir, DEFAULT_PROJECT_SUBFOLDER),
    path.join(executableDir, "app", DEFAULT_PROJECT_SUBFOLDER),
  ];
}

function hasProjectData(value: string): boolean {
  try {
    return fs.statSync(value).isDirectory() && fs.readdirSync(value).length > 0;
  } catch {
    return false;
  }
}

function findKnownProjectRootWithData(excludedRoot: string): string | undefined {
  const candidates = app.isPackaged
    ? [...getLegacyPackagedProjectRoots(), path.join(app.getPath("userData"), DEFAULT_PROJECT_SUBFOLDER), getPackagedProjectRoot()]
    : [path.join(app.getPath("userData"), DEFAULT_PROJECT_SUBFOLDER), path.resolve(__dirname, "..", "..", "..", "project")];
  const excluded = path.resolve(excludedRoot).toLowerCase();
  return candidates
    .map((candidate) => path.resolve(candidate))
    .find((candidate) => candidate.toLowerCase() !== excluded && hasProjectData(candidate));
}

function getDefaultProjectRoot(): string {
  return path.join(app.getPath("userData"), DEFAULT_PROJECT_SUBFOLDER);
}

export function getProjectRoot(): string { return PROJECT_ROOT; }

/** 仅使用默认路径或已保存配置；修改目录统一由设置中的迁移入口处理。 */
export function loadInitialProjectRoot(): string {
  let hasSavedRoot = false;
  let directoryRecoveryFailed = false;
  try {
    if (fs.existsSync(projectRootConfigPath())) {
      hasSavedRoot = true;
      const config = JSON.parse(fs.readFileSync(projectRootConfigPath(), "utf8"));
      if (typeof config.projectRoot === "string" && path.isAbsolute(config.projectRoot)) {
        PROJECT_ROOT = config.projectRoot;
      }
    }
  } catch {
    // 旧配置格式损坏时使用默认目录。
  }
  if (!PROJECT_ROOT) {
    if (app.isPackaged) {
      const preferred = getPackagedProjectRoot();
      const legacy = getLegacyPackagedProjectRoots().find(hasProjectData);
      // 已有旧安装目录数据时先继续使用它，避免升级后显示空项目；用户可在设置中迁移。
      // 安装程序留下的空 project 目录不算旧数据，应直接使用新的用户数据目录。
      PROJECT_ROOT = legacy || preferred;
    } else {
      PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "project");
    }
  }
  try {
    reconcileMovedDirectoryOnStartup();
  } catch (error) {
    directoryRecoveryFailed = true;
    console.error("[project root] 恢复目录迁移状态失败，保留现场并继续初始化项目", error);
  }
  if ((hasSavedRoot && !fs.existsSync(PROJECT_ROOT)) || (directoryRecoveryFailed && !hasProjectData(PROJECT_ROOT))) {
    const configuredRoot = PROJECT_ROOT;
    const recoveredRoot = findKnownProjectRootWithData(configuredRoot) || getDefaultProjectRoot();
    try {
      writeMigrationJson(projectRootConfigPath(), { projectRoot: recoveredRoot });
    } catch (error) {
      console.error("[project root] 保存恢复后的项目路径失败，继续使用本次启动路径", error);
    }
    PROJECT_ROOT = recoveredRoot;
    console.warn("[project root] 已恢复失效的项目保存路径", {
      previousRoot: configuredRoot,
      recoveredRoot,
      existingProjectData: hasProjectData(recoveredRoot),
    });
  }
  return PROJECT_ROOT;
}

function reconcileMovedDirectoryOnStartup(): void {
  const journal = readDirectoryMigrationJournal(migrationJournalPath());
  if (!journal || journal.version !== 3 || journal.phase === "complete") return;
  const sourceExists = fs.existsSync(journal.source);
  const targetExists = fs.existsSync(journal.target);
  const identity = (value: string) => {
    const stat = fs.lstatSync(value, { bigint: true });
    return { dev: stat.dev.toString(), ino: stat.ino.toString(), birthtimeMs: Number(stat.birthtimeMs) };
  };
  const sameIdentity = (value: string) => {
    try {
      const stat = fs.lstatSync(value);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
      const actual = identity(value);
      return actual.dev === journal.sourceIdentity.dev
        && actual.ino === journal.sourceIdentity.ino
        && Math.abs(actual.birthtimeMs - journal.sourceIdentity.birthtimeMs) < 2;
    } catch {
      return false;
    }
  };
  const sourceIsMigratedRoot = sourceExists && sameIdentity(journal.source);
  const targetIsMigratedRoot = targetExists && sameIdentity(journal.target);
  if (targetIsMigratedRoot) {
    // 根目录已移动，配置仍指向旧目录：先恢复配置，避免后续 ensureProjectRoot 创建空源目录。
    writeMigrationJson(projectRootConfigPath(), { projectRoot: journal.target });
    PROJECT_ROOT = journal.target;
    journal.phase = "complete";
    writeMigrationJson(migrationJournalPath(), journal);
    return;
  }
  if (!sourceIsMigratedRoot) {
    throw new Error("未找到可恢复的项目目录，请保留现场检查");
  }
  // 旧版目录移动未完成时继续使用已确认的源目录，由设置页按复制流程恢复。
  PROJECT_ROOT = journal.source;
}

export function ensureProjectRoot(): void {
  if (!PROJECT_ROOT) loadInitialProjectRoot();
  if (!fs.existsSync(PROJECT_ROOT)) {
    // 缺失的保存目录允许重建，启动时的数据库拆分会把旧总库记录保留在源库。
    fs.mkdirSync(PROJECT_ROOT, { recursive: true });
  }
}

export function getDataPathMigrationStatus(): { pending: boolean; target?: string; phase?: string } {
  const journal = readDirectoryMigrationJournal(migrationJournalPath());
  if (!journal || journal.phase === "complete") return { pending: false };
  return { pending: true, target: journal.target, phase: journal.phase };
}

export async function migrateDataPath(
  newPath: string, onProgress?: (progress: DirectoryMigrationProgress) => void,
): Promise<DirectoryMigrationResult> {
  const release = beginProjectDirectoryMigration();
  try {
    const { closeAllProjectDatabases } = await import("./project-database");
    await closeAllProjectDatabases();
    if (!fs.existsSync(projectRootConfigPath())) ensureProjectRoot();
    return await migrateProjectDirectory({
      source: PROJECT_ROOT || loadInitialProjectRoot(), target: newPath,
      journalPath: migrationJournalPath(), onProgress,
      commitRoot: (target) => {
        writeMigrationJson(projectRootConfigPath(), { projectRoot: target });
        PROJECT_ROOT = target;
        notifyProjectRootChanged();
      },
    });
  } finally { release(); }
}
