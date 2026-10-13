import fs from "node:fs";
import path from "node:path";
import {
  closeAllDatabaseConnections,
  openDatabaseAtPath,
  runCurrentDatabaseMigrations,
  setDatabaseScope,
  type DbWrapper,
} from "@robot/database";
import {
  readProjectManifestForMigration,
  updateProjectDatabaseMetadata,
  type ProjectManifest,
} from "./project-manifest";
import { resolveProjectDir } from "./project-paths";

export const PROJECT_DATABASE_RELATIVE_PATH = "database/robot-config.db";
export const PROJECT_DATABASE_FORMAT_VERSION = 1;

export interface ProjectDatabaseSession {
  projectName: string;
  projectId: string;
  sessionVersion: number;
}

interface OpenProjectDatabase {
  projectName: string;
  projectId: string;
  filePath: string;
  database: DbWrapper;
}

const openDatabases = new Map<string, OpenProjectDatabase>();
let activeSession: ProjectDatabaseSession | null = null;
let sessionVersion = 0;
let operationQueue: Promise<unknown> = Promise.resolve();

function serialize<T>(operation: () => Promise<T> | T): Promise<T> {
  const current = operationQueue.then(operation, operation);
  operationQueue = current.then(() => undefined, () => undefined);
  return current;
}

function resolveDatabaseFile(projectDir: string, manifest: ProjectManifest): string {
  const relative = manifest.database?.path || PROJECT_DATABASE_RELATIVE_PATH;
  if (path.isAbsolute(relative)) throw new Error("项目数据库路径必须是项目目录内的相对路径");
  const filePath = path.resolve(projectDir, relative);
  const relativeToProject = path.relative(projectDir, filePath);
  if (!relativeToProject || relativeToProject.startsWith("..") || path.isAbsolute(relativeToProject)) {
    throw new Error("项目数据库路径越出项目目录");
  }
  return filePath;
}

function readDatabaseMetadata(database: DbWrapper): Record<string, any> | undefined {
  return database.prepare("SELECT * FROM project_database_meta WHERE id = 1").get() as Record<string, any> | undefined;
}

function assertDatabaseOwner(database: DbWrapper, projectName: string, projectId: string): void {
  const metadata = readDatabaseMetadata(database);
  if (!metadata) throw new Error(`项目数据库缺少身份信息：${projectName}，请从备份恢复或重新迁移`);
  if (metadata.projectId !== projectId) throw new Error(`项目数据库身份不匹配：${projectName}`);
  if (metadata.projectName !== projectName) throw new Error(`项目数据库名称不匹配：${metadata.projectName} / ${projectName}`);
  if (Number(metadata.formatVersion) !== PROJECT_DATABASE_FORMAT_VERSION) throw new Error(`项目数据库格式版本不受支持：${projectName}`);
}

async function readProjectContext(projectName: string): Promise<{
  projectDir: string;
  manifest: ProjectManifest;
  filePath: string;
}> {
  const projectDir = resolveProjectDir(projectName);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    throw new Error(`项目目录不存在：${projectName}`);
  }
  const manifest = readProjectManifestForMigration(projectDir, projectName);
  const filePath = resolveDatabaseFile(projectDir, manifest);
  if (!manifest.database || !fs.existsSync(filePath)) {
    throw new Error(`项目数据库缺失：${projectName}。旧项目不能按空项目打开，请恢复数据库或旧版总库`);
  }
  return { projectDir, manifest, filePath };
}

async function openProjectDatabaseInternal(projectName: string): Promise<OpenProjectDatabase> {
  const { manifest, filePath } = await readProjectContext(projectName);
  const projectId = manifest.project.id;
  const cached = openDatabases.get(projectId);
  if (cached && cached.filePath === filePath && cached.projectName === projectName) return cached;
  if (cached) {
    cached.database.close();
    openDatabases.delete(projectId);
  }

  const database = await openDatabaseAtPath(filePath, false);
  try {
    runCurrentDatabaseMigrations(database);
    assertDatabaseOwner(database, projectName, projectId);
    database.saveToDisk("project-schema-migration");
  } catch (error) {
    database.discardAndClose();
    throw error;
  }

  const opened = { projectName, projectId, filePath, database };
  openDatabases.set(projectId, opened);
  return opened;
}

async function withDatabaseScope<T>(opened: OpenProjectDatabase, operation: (database: DbWrapper) => Promise<T> | T): Promise<T> {
  setDatabaseScope(opened.database);
  try {
    return await operation(opened.database);
  } finally {
    setDatabaseScope(null);
    for (const [projectId, cached] of openDatabases) {
      if (projectId !== activeSession?.projectId && projectId !== opened.projectId) {
        cached.database.close();
        openDatabases.delete(projectId);
      }
    }
    if (opened.projectId !== activeSession?.projectId) {
      opened.database.close();
      openDatabases.delete(opened.projectId);
    }
  }
}

export function withProjectDatabase<T>(
  projectName: string,
  operation: (database: DbWrapper) => Promise<T> | T,
): Promise<T> {
  return serialize(async () => {
    const opened = await openProjectDatabaseInternal(projectName);
    return withDatabaseScope(opened, operation);
  });
}

export function withProjectDatabaseSession<T>(
  projectName: string,
  version: number,
  operation: (database: DbWrapper) => Promise<T> | T,
): Promise<T> {
  return serialize(async () => {
    if (!activeSession || activeSession.projectName !== projectName || activeSession.sessionVersion !== version) {
      throw new Error("项目数据库会话已切换，请重试当前操作");
    }
    const opened = await openProjectDatabaseInternal(projectName);
    if (opened.projectId !== activeSession.projectId) throw new Error("项目数据库身份已变化，请重新打开项目");
    return withDatabaseScope(opened, operation);
  });
}

export function openProjectDatabase(projectName: string): Promise<ProjectDatabaseSession> {
  return serialize(async () => {
    const { manifest } = await readProjectContext(projectName);
    for (const [projectId, cached] of openDatabases) {
      if (projectId !== manifest.project.id) {
        cached.database.close();
        openDatabases.delete(projectId);
      }
    }
    const opened = await openProjectDatabaseInternal(projectName);
    activeSession = {
      projectName,
      projectId: opened.projectId,
      sessionVersion: ++sessionVersion,
    };
    return { ...activeSession };
  });
}

export function getActiveProjectDatabaseSession(): ProjectDatabaseSession | null {
  return activeSession ? { ...activeSession } : null;
}

export function closeProjectDatabase(projectName: string): Promise<void> {
  return serialize(async () => {
    const projectDir = resolveProjectDir(projectName);
    if (!fs.existsSync(projectDir)) return;
    const manifest = readProjectManifestForMigration(projectDir, projectName);
    const projectId = manifest.project.id;
    const cached = openDatabases.get(projectId);
    if (cached) {
      cached.database.close();
      openDatabases.delete(projectId);
    }
    if (activeSession?.projectId === projectId) activeSession = null;
    sessionVersion += 1;
  });
}

export function closeActiveProjectDatabase(): Promise<void> {
  return serialize(() => {
    if (activeSession) {
      const opened = openDatabases.get(activeSession.projectId);
      if (opened) {
        opened.database.close();
        openDatabases.delete(activeSession.projectId);
      }
      activeSession = null;
      sessionVersion += 1;
    }
  });
}

export function invalidateProjectDatabaseSession(projectName: string): Promise<void> {
  return serialize(() => {
    if (activeSession?.projectName === projectName) {
      activeSession = null;
      sessionVersion += 1;
    }
  });
}

export function closeAllProjectDatabases(): Promise<void> {
  return serialize(() => {
    setDatabaseScope(null);
    let closeError: unknown;
    try { closeAllDatabaseConnections(); } catch (error) { closeError = error; }
    for (const [projectId, opened] of openDatabases) {
      if (opened.database.isClosed()) openDatabases.delete(projectId);
    }
    activeSession = null;
    sessionVersion += 1;
    if (closeError) throw closeError;
  });
}

export async function initializeNewProjectDatabase(projectName: string): Promise<void> {
  await serialize(async () => {
    const projectDir = resolveProjectDir(projectName);
    const manifest = readProjectManifestForMigration(projectDir, projectName);
    const filePath = resolveDatabaseFile(projectDir, manifest);
    if (fs.existsSync(filePath)) throw new Error(`项目数据库已存在：${projectName}`);

    const database = await openDatabaseAtPath(filePath, true);
    try {
      runCurrentDatabaseMigrations(database);
      const now = new Date().toISOString();
      database.prepare(`
        INSERT INTO project_database_meta
          (id, project_id, project_name, format_version, migration_batch_id, source_fingerprint, created_at, updated_at)
        VALUES (1, ?, ?, ?, NULL, NULL, ?, ?)
      `).run(manifest.project.id, projectName, PROJECT_DATABASE_FORMAT_VERSION, now, now);
      database.saveToDisk("new-project-database");
      updateProjectDatabaseMetadata(projectName, {
        path: manifest.database?.path || PROJECT_DATABASE_RELATIVE_PATH,
        formatVersion: PROJECT_DATABASE_FORMAT_VERSION,
        migrationBatchId: null,
        sourceFingerprint: null,
      });
      database.close();
    } catch (error) {
      database.discardAndClose();
      try { fs.rmSync(filePath, { force: true }); } catch { /* keep the initialization error */ }
      throw error;
    }
  });
}
