import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  CURRENT_DATABASE_SCHEMA_VERSION, openDatabaseAtPath, runCurrentDatabaseMigrations, runMigrations,
  type DbWrapper, migration001Version, migration001Name, migration001Up, migration001Down,
  migration002Version, migration002Name, migration002Up, migration002Down,
  migration003Version, migration003Name, migration003Up, migration003Down,
  migration004Version, migration004Name, migration004Up, migration004Down,
  migration005Version, migration005Name, migration005Up, migration005Down,
} from "@robot/database";
import {
  manifestPath, readProjectManifestForMigration,
  writeProjectManifestByDir, type ProjectManifest,
} from "./project-manifest";
import { PROJECT_DATABASE_FORMAT_VERSION, PROJECT_DATABASE_RELATIVE_PATH } from "./project-database";

const PROJECT_TABLES = ["project_station", "device_voltage", "device_bay", "device_main", "device_component", "device_point"] as const;
const AUTOINCREMENT_TABLES = PROJECT_TABLES;
type MigrationStatus = "pending" | "copying" | "published" | "complete";

interface ProjectMigrationRecord {
  projectId: string;
  projectName: string;
  databasePath: string;
  status: MigrationStatus;
  rowCounts?: Record<string, number>;
}

interface ProjectDatabaseMigrationJournal {
  version: 1;
  batchId: string;
  phase: "splitting" | "complete";
  sourcePath: string;
  sourceFingerprint: string;
  projects: ProjectMigrationRecord[];
  updatedAt: string;
}

interface ProjectContext {
  name: string;
  id: string;
  directory: string;
  manifest: ProjectManifest;
  databasePath: string;
}

const legacyMigrations = [
  { version: migration001Version, name: migration001Name, up: migration001Up, down: migration001Down },
  { version: migration002Version, name: migration002Name, up: migration002Up, down: migration002Down },
  { version: migration003Version, name: migration003Name, up: migration003Up, down: migration003Down },
  { version: migration004Version, name: migration004Name, up: migration004Up, down: migration004Down },
  { version: migration005Version, name: migration005Name, up: migration005Up, down: migration005Down },
];

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = filePath + "." + process.pid + "." + randomUUID() + ".tmp";
  try {
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2) + "\n", { encoding: "utf-8", flag: "wx" });
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }); } catch { /* retain the original error */ }
    throw error;
  }
}

function readJournal(filePath: string): ProjectDatabaseMigrationJournal | null {
  if (!fs.existsSync(filePath)) return null;
  let raw: any;
  try { raw = JSON.parse(fs.readFileSync(filePath, "utf-8")); }
  catch (error) {
    throw new Error("项目数据库迁移台账损坏：" + filePath + "；" + (error instanceof Error ? error.message : String(error)));
  }
  if (raw?.version !== 1 || !Array.isArray(raw.projects) || !raw.batchId || !raw.sourceFingerprint) {
    throw new Error("项目数据库迁移台账格式无效：" + filePath);
  }
  return raw as ProjectDatabaseMigrationJournal;
}

function saveJournal(filePath: string, journal: ProjectDatabaseMigrationJournal): void {
  journal.updatedAt = new Date().toISOString();
  writeJsonAtomic(filePath, journal);
}

async function fingerprintFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function listProjectContexts(projectRoot: string): ProjectContext[] {
  if (!fs.existsSync(projectRoot)) return [];
  const names = fs.readdirSync(projectRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== ".potree-converter-runtime")
    .map((entry) => entry.name);
  const contexts = names.map((name) => {
    const directory = path.join(projectRoot, name);
    const filePath = manifestPath(directory);
    const manifest = readProjectManifestForMigration(directory, name);
    if (!fs.existsSync(filePath)) writeProjectManifestByDir(directory, manifest);
    const relativeDatabasePath = manifest.database?.path || PROJECT_DATABASE_RELATIVE_PATH;
    if (path.isAbsolute(relativeDatabasePath)) throw new Error("项目 " + name + " 的数据库路径必须为相对路径");
    const databasePath = path.resolve(directory, relativeDatabasePath);
    const relative = path.relative(directory, databasePath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("项目 " + name + " 的数据库路径越出项目目录");
    }
    return { name, id: manifest.project.id, directory, manifest, databasePath };
  });
  const idOwners = new Map<string, string>();
  for (const project of contexts) {
    const owner = idOwners.get(project.id);
    if (owner) throw new Error("项目清单 ID 重复：" + owner + " 与 " + project.name + " (" + project.id + ")");
    idOwners.set(project.id, project.name);
  }
  return contexts;
}

function readTableCounts(database: DbWrapper, projectName: string): Record<string, number> {
  return Object.fromEntries(PROJECT_TABLES.map((table) => {
    const row = database.prepare("SELECT COUNT(*) AS count FROM " + table + " WHERE project_name = ?").get(projectName) as { count?: number } | undefined;
    return [table, Number(row?.count || 0)];
  }));
}

function preflightProjectOwnership(database: DbWrapper, contexts: ProjectContext[]): Map<string, Record<string, number>> {
  const projectsByName = new Set(contexts.map((project) => project.name));
  const countsByName = new Map<string, Record<string, number>>();
  const unassigned: string[] = [];
  const unknown: string[] = [];
  for (const table of PROJECT_TABLES) {
    const rows = database.prepare("SELECT project_name AS projectName, COUNT(*) AS count FROM " + table + " GROUP BY project_name").all() as Array<{ projectName: string | null; count: number }>;
    for (const row of rows) {
      const name = row.projectName === null ? "" : String(row.projectName);
      if (!name.trim()) {
        unassigned.push(table + ":" + row.count);
        continue;
      }
      if (!projectsByName.has(name)) {
        unknown.push(table + ":" + name + " (" + row.count + ")");
        continue;
      }
      const counts = countsByName.get(name) || Object.fromEntries(PROJECT_TABLES.map((item) => [item, 0]));
      counts[table] = Number(row.count);
      countsByName.set(name, counts);
    }
  }
  if (unassigned.length || unknown.length) {
    const details = [
      unassigned.length ? "项目名为空：" + unassigned.join("、") : "",
      unknown.length ? "找不到项目目录：" + unknown.join("、") : "",
    ].filter(Boolean).join("；");
    throw new Error("旧总库预检失败，未归属记录不会被丢弃；" + details);
  }
  for (const context of contexts) {
    if (!countsByName.has(context.name)) countsByName.set(context.name, Object.fromEntries(PROJECT_TABLES.map((table) => [table, 0])));
  }
  return countsByName;
}

function getTableColumns(database: DbWrapper, table: string): string[] {
  return (database.prepare("PRAGMA table_info(" + table + ")").all() as Array<{ name: string }>).map((column) => column.name);
}

function getSourceSequence(database: DbWrapper, table: string): number | null {
  const row = database.prepare("SELECT seq FROM sqlite_sequence WHERE name = ?").get(table) as { seq?: number } | undefined;
  return row?.seq === undefined ? null : Number(row.seq);
}

function setTargetSequence(database: DbWrapper, table: string, sequence: number): void {
  const update = database.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = ?").run(sequence, table);
  if (update.changes === 0) database.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)").run(table, sequence);
}

function assertProjectRelations(database: DbWrapper, projectName: string): void {
  const checks = [
    ["device_bay.volt_id", "SELECT COUNT(*) AS count FROM device_bay b LEFT JOIN device_voltage v ON v.id = b.volt_id WHERE b.volt_id IS NOT NULL AND b.volt_id <> 0 AND v.id IS NULL"],
    ["device_main.bay_id", "SELECT COUNT(*) AS count FROM device_main m LEFT JOIN device_bay b ON b.id = m.bay_id WHERE m.bay_id IS NOT NULL AND m.bay_id <> 0 AND b.id IS NULL"],
    ["device_component.main_device_id", "SELECT COUNT(*) AS count FROM device_component c LEFT JOIN device_main m ON m.id = c.main_device_id WHERE c.main_device_id IS NOT NULL AND c.main_device_id <> 0 AND m.id IS NULL"],
    ["device_point.component_id", "SELECT COUNT(*) AS count FROM device_point p LEFT JOIN device_component c ON c.id = p.component_id WHERE p.component_id IS NOT NULL AND p.component_id <> 0 AND c.id IS NULL"],
    ["device_point.main_device_id", "SELECT COUNT(*) AS count FROM device_point p LEFT JOIN device_main m ON m.id = p.main_device_id WHERE p.main_device_id IS NOT NULL AND p.main_device_id <> 0 AND m.id IS NULL"],
    ["device_main.volt_id", "SELECT COUNT(*) AS count FROM device_main m LEFT JOIN device_voltage v ON v.id = m.volt_id WHERE m.volt_id IS NOT NULL AND m.volt_id <> 0 AND v.id IS NULL"],
    ["device_component.bay_id", "SELECT COUNT(*) AS count FROM device_component c LEFT JOIN device_bay b ON b.id = c.bay_id WHERE c.bay_id IS NOT NULL AND c.bay_id <> 0 AND b.id IS NULL"],
    ["device_component.volt_id", "SELECT COUNT(*) AS count FROM device_component c LEFT JOIN device_voltage v ON v.id = c.volt_id WHERE c.volt_id IS NOT NULL AND c.volt_id <> 0 AND v.id IS NULL"],
    ["device_point.bay_id", "SELECT COUNT(*) AS count FROM device_point p LEFT JOIN device_bay b ON b.id = p.bay_id WHERE p.bay_id IS NOT NULL AND p.bay_id <> 0 AND b.id IS NULL"],
    ["device_point.volt_id", "SELECT COUNT(*) AS count FROM device_point p LEFT JOIN device_voltage v ON v.id = p.volt_id WHERE p.volt_id IS NOT NULL AND p.volt_id <> 0 AND v.id IS NULL"],
  ] as const;
  const problems = checks.flatMap(([label, sql]) => {
    const row = database.prepare(sql).get() as { count?: number } | undefined;
    const count = Number(row?.count || 0);
    return count ? [label + "=" + count] : [];
  });
  if (problems.length) throw new Error("项目 " + projectName + " 存在跨表关联缺失：" + problems.join("，"));
}

function assertDatabaseIntegrity(database: DbWrapper, projectName: string, projectId: string): void {
  const integrity = database.prepare("PRAGMA integrity_check").get();
  if (Object.values(integrity || {})[0] !== "ok") throw new Error("项目 " + projectName + " 数据库完整性检查失败");
  const metadata = database.prepare("SELECT * FROM project_database_meta WHERE id = 1").get() as Record<string, any> | undefined;
  if (!metadata || metadata.projectId !== projectId || metadata.projectName !== projectName) {
    throw new Error("项目 " + projectName + " 数据库归属校验失败");
  }
  const version = database.prepare("SELECT MAX(version) AS version FROM schema_version").get() as { version?: number } | undefined;
  if (Number(metadata.formatVersion) !== PROJECT_DATABASE_FORMAT_VERSION) throw new Error("项目数据库格式版本不受支持：" + projectName);
  if (Number(version?.version || 0) !== CURRENT_DATABASE_SCHEMA_VERSION) {
    throw new Error("项目 " + projectName + " 数据库 schema 版本不匹配");
  }
  assertProjectRelations(database, projectName);
}

function assertProjectRowCounts(database: DbWrapper, projectName: string, expected: Record<string, number>): void {
  for (const table of PROJECT_TABLES) {
    const countRow = database.prepare("SELECT COUNT(*) AS count FROM " + table).get() as { count?: number } | undefined;
    const actual = Number(countRow?.count || 0);
    if (actual !== Number(expected[table] || 0)) {
      throw new Error("项目 " + projectName + " 的 " + table + " 记录数不一致：旧库 " + (expected[table] || 0) + "，新库 " + actual);
    }
    const foreignProjectRows = database.prepare("SELECT COUNT(*) AS count FROM " + table + " WHERE project_name IS NULL OR project_name <> ?").get(projectName) as { count?: number } | undefined;
    if (Number(foreignProjectRows?.count || 0) > 0) throw new Error("项目 " + projectName + " 的 " + table + " 包含其他项目记录");
  }
}

function writeDatabaseMetadata(database: DbWrapper, project: ProjectContext, batchId: string | null, sourceFingerprint: string | null): void {
  const now = new Date().toISOString();
  database.prepare(
    "INSERT INTO project_database_meta " +
    "(id, project_id, project_name, format_version, migration_batch_id, source_fingerprint, created_at, updated_at) " +
    "VALUES (1, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, project_name = excluded.project_name, " +
    "format_version = excluded.format_version, migration_batch_id = excluded.migration_batch_id, " +
    "source_fingerprint = excluded.source_fingerprint, updated_at = excluded.updated_at",
  ).run(project.id, project.name, PROJECT_DATABASE_FORMAT_VERSION, batchId, sourceFingerprint, now, now);
}

function copyProjectRows(source: DbWrapper, target: DbWrapper, projectName: string): Record<string, number> {
  const counts = Object.fromEntries(PROJECT_TABLES.map((table) => [table, 0])) as Record<string, number>;
  target.transaction(() => {
    for (const table of PROJECT_TABLES) {
      const columns = getTableColumns(target, table);
      const columnSql = columns.map((column) => "\"" + column + "\"").join(", ");
      const placeholders = columns.map(() => "?").join(", ");
      const insert = target.prepare("INSERT INTO " + table + " (" + columnSql + ") VALUES (" + placeholders + ")");
      counts[table] = source.forEach(
        "SELECT * FROM " + table + " WHERE project_name = ? ORDER BY id",
        [projectName],
        (row) => insert.run(...columns.map((column) => row[column])),
      );
    }
    for (const table of AUTOINCREMENT_TABLES) {
      const sequence = getSourceSequence(source, table);
      if (sequence !== null) setTargetSequence(target, table, sequence);
    }
    const calibrationSequence = source.prepare("SELECT next_id AS nextId FROM calibration_sequence WHERE id = 1").get() as { nextId?: number } | undefined;
    if (calibrationSequence) target.prepare("UPDATE calibration_sequence SET next_id = ? WHERE id = 1").run(Number(calibrationSequence.nextId));
  })();
  return counts;
}

function makeJournal(sourcePath: string, sourceFingerprint: string, projects: ProjectContext[]): ProjectDatabaseMigrationJournal {
  const batchId = randomUUID();
  return {
    version: 1,
    batchId,
    phase: "splitting",
    sourcePath,
    sourceFingerprint,
    projects: projects.map((project) => ({
      projectId: project.id,
      projectName: project.name,
      databasePath: project.databasePath,
      status: "pending",
    })),
    updatedAt: new Date().toISOString(),
  };
}

async function verifyProjectFile(
  context: ProjectContext,
  expectedCounts?: Record<string, number>,
  expectedSourceFingerprint?: string,
  expectedBatchId?: string,
): Promise<NonNullable<ProjectManifest["database"]>> {
  if (!fs.existsSync(context.databasePath)) throw new Error("项目数据库缺失：" + context.name);
  const database = await openDatabaseAtPath(context.databasePath, false);
  try {
    runCurrentDatabaseMigrations(database);
    assertDatabaseIntegrity(database, context.name, context.id);
    if (expectedCounts) assertProjectRowCounts(database, context.name, expectedCounts);
    const metadata = database.prepare("SELECT * FROM project_database_meta WHERE id = 1").get() as Record<string, any>;
    const fingerprint = expectedSourceFingerprint || context.manifest.database?.sourceFingerprint;
    const batchId = expectedBatchId || context.manifest.database?.migrationBatchId;
    if (fingerprint && metadata.sourceFingerprint !== fingerprint) {
      throw new Error("项目 " + context.name + " 的数据库来源与当前迁移批次不匹配");
    }
    if (batchId && metadata.migrationBatchId !== batchId) {
      throw new Error("项目 " + context.name + " 的数据库迁移批次不匹配");
    }
    database.saveToDisk("verify-project-schema");
    return {
      path: path.relative(context.directory, context.databasePath).replace(/\\/g, "/"),
      formatVersion: Number(metadata.formatVersion),
      migrationBatchId: metadata.migrationBatchId || null,
      sourceFingerprint: metadata.sourceFingerprint || null,
    };
  } finally {
    database.discardAndClose();
  }
}

function updateManifestAfterMigration(context: ProjectContext, batchId: string, sourceFingerprint: string): void {
  context.manifest.database = {
    path: context.manifest.database?.path || PROJECT_DATABASE_RELATIVE_PATH,
    formatVersion: PROJECT_DATABASE_FORMAT_VERSION,
    migrationBatchId: batchId,
    sourceFingerprint,
  };
  writeProjectManifestByDir(context.directory, context.manifest);
}

async function migrateOneProject(
  source: DbWrapper,
  sourcePath: string,
  context: ProjectContext,
  record: ProjectMigrationRecord,
  journal: ProjectDatabaseMigrationJournal,
  journalPath: string,
  expectedCounts: Record<string, number>,
): Promise<void> {
  if (record.status === "complete") {
    await verifyProjectFile(context, expectedCounts, journal.sourceFingerprint, journal.batchId);
    return;
  }

  fs.mkdirSync(path.dirname(context.databasePath), { recursive: true });
  const stagePath = context.databasePath + "." + journal.batchId + ".tmp";
  if (fs.existsSync(context.databasePath)) {
    const database = await openDatabaseAtPath(context.databasePath, false);
    try {
      const metadata = database.prepare("SELECT * FROM project_database_meta WHERE id = 1").get() as Record<string, any> | undefined;
      if (!metadata || metadata.projectId !== context.id || metadata.projectName !== context.name
        || metadata.sourceFingerprint !== journal.sourceFingerprint || metadata.migrationBatchId !== journal.batchId) {
        throw new Error("项目 " + context.name + " 已存在不属于本迁移批次的数据库，拒绝覆盖");
      }
      assertDatabaseIntegrity(database, context.name, context.id);
      assertProjectRowCounts(database, context.name, expectedCounts);
    } finally {
      database.discardAndClose();
    }
    updateManifestAfterMigration(context, journal.batchId, journal.sourceFingerprint);
    record.status = "complete";
    record.rowCounts = expectedCounts;
    saveJournal(journalPath, journal);
    return;
  }

  record.status = "copying";
  saveJournal(journalPath, journal);
  try { fs.rmSync(stagePath, { force: true }); } catch { /* recreate a stale stage */ }
  const target = await openDatabaseAtPath(stagePath, true);
  try {
    runCurrentDatabaseMigrations(target);
    const copiedCounts = copyProjectRows(source, target, context.name);
    for (const table of PROJECT_TABLES) {
      if (copiedCounts[table] !== Number(expectedCounts[table] || 0)) {
        throw new Error("项目 " + context.name + " 拆分 " + table + " 数量异常：预期 " + (expectedCounts[table] || 0) + "，实际 " + copiedCounts[table]);
      }
    }
    writeDatabaseMetadata(target, context, journal.batchId, journal.sourceFingerprint);
    assertDatabaseIntegrity(target, context.name, context.id);
    assertProjectRowCounts(target, context.name, expectedCounts);
    target.saveToDisk("legacy-project-database-split");
  } catch (error) {
    target.discardAndClose();
    try { fs.rmSync(stagePath, { force: true }); } catch { /* retain the migration error */ }
    throw error;
  }
  target.close();

  if (fs.existsSync(context.databasePath)) throw new Error("项目 " + context.name + " 的目标数据库在发布前出现，拒绝覆盖");
  fs.renameSync(stagePath, context.databasePath);
  record.status = "published";
  record.rowCounts = expectedCounts;
  saveJournal(journalPath, journal);
  await verifyProjectFile(context, expectedCounts, journal.sourceFingerprint, journal.batchId);
  updateManifestAfterMigration(context, journal.batchId, journal.sourceFingerprint);
  record.status = "complete";
  saveJournal(journalPath, journal);
  console.info("[DB migration] 项目数据库拆分完成", { projectName: context.name, rowCounts: expectedCounts, sourcePath });
}

export interface ProjectDatabaseMigrationOptions {
  projectRoot: string;
  legacyDatabasePath: string;
  journalPath: string;
}

export async function migrateLegacyProjectDatabases(options: ProjectDatabaseMigrationOptions): Promise<void> {
  const projectRoot = path.resolve(options.projectRoot);
  const sourcePath = path.resolve(options.legacyDatabasePath);
  const journalPath = path.resolve(options.journalPath);
  const contexts = listProjectContexts(projectRoot);
  let journal = readJournal(journalPath);

  // 完成后项目库是唯一业务来源，旧库仅保留作备份；重命名、删除、搬迁不重新拆分。
  if (journal?.phase === "complete" || (!journal && contexts.length > 0 && contexts.every((context) => fs.existsSync(context.databasePath)))) {
    for (const context of contexts) {
      const original = journal?.projects.find((record) => record.projectId === context.id);
      const metadata = await verifyProjectFile(context, undefined,
        !context.manifest.database && original ? journal?.sourceFingerprint : undefined,
        !context.manifest.database && original ? journal?.batchId : undefined);
      if (!context.manifest.database) {
        context.manifest.database = metadata;
        writeProjectManifestByDir(context.directory, context.manifest);
        console.info("[DB migration] 已从有效项目库恢复清单数据库元数据", context.name);
      }
    }
    return;
  }

  if (!fs.existsSync(sourcePath)) {
    if (contexts.length === 0 && !journal) return;
    throw new Error("旧总库不存在，且项目数据库迁移未全部完成：" + sourcePath + "。请从备份恢复旧总库");
  }

  const sourceFingerprint = await fingerprintFile(sourcePath);
  if (journal && (journal.sourcePath !== sourcePath || journal.sourceFingerprint !== sourceFingerprint)) {
    throw new Error("迁移期间旧总库发生变化，请保留旧库和项目数据库现场后恢复");
  }

  const source = await openDatabaseAtPath(sourcePath, false, false);
  try {
    runMigrations(source, legacyMigrations);
    const sourceVersion = source.prepare("SELECT MAX(version) AS version FROM schema_version").get() as { version: number };
    if (sourceVersion.version > CURRENT_DATABASE_SCHEMA_VERSION) throw new Error("旧总库结构比当前客户端更新，禁止降级拆分");
    const expectedByName = preflightProjectOwnership(source, contexts);
    const projectCounts = new Map(contexts.map((context) => [context.name, readTableCounts(source, context.name)]));
    if (!journal) {
      journal = makeJournal(sourcePath, sourceFingerprint, contexts);
      saveJournal(journalPath, journal);
    }
    const recordsById = new Map(journal.projects.map((record) => [record.projectId, record]));
    if (journal.projects.length !== contexts.length) throw new Error("迁移台账中的项目清单与当前项目目录不一致");
    for (const context of contexts) {
      const record = recordsById.get(context.id);
      if (!record || record.projectName !== context.name || path.resolve(record.databasePath) !== context.databasePath) {
        throw new Error("项目 " + context.name + " 与迁移台账不匹配；请保留现场后恢复");
      }
      await migrateOneProject(
        source,
        sourcePath,
        context,
        record,
        journal,
        journalPath,
        projectCounts.get(context.name) || expectedByName.get(context.name) || {},
      );
    }
    journal.phase = "complete";
    saveJournal(journalPath, journal);
    console.info("[DB migration] 旧总库拆分批次完成", { batchId: journal.batchId, projects: contexts.length, sourcePath });
  } finally {
    source.discardAndClose();
  }
}
