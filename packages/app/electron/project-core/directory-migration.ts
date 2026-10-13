import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

type MigrationPhase = "moving" | "copying" | "verified" | "published" | "switched" | "complete";
interface Entry {
  relativePath: string;
  directory: boolean;
  size: number;
  mtimeMs: number;
  hash?: string;
  copyState?: "copying" | "copied";
}
interface DirectoryMigrationJournalBase {
  source: string;
  target: string;
  phase: MigrationPhase;
  entries: Entry[];
}
interface LegacyDirectoryMigrationJournal extends DirectoryMigrationJournalBase { version: 1; staging: string; verifyContent?: boolean }
interface DirectDirectoryMigrationJournal extends DirectoryMigrationJournalBase {
  version: 2; copyMode: "direct"; verifyContent: boolean; warning?: string;
}
interface RootIdentity { dev: string; ino: string; birthtimeMs: number }
interface MoveDirectoryMigrationJournal {
  source: string;
  target: string;
  phase: MigrationPhase;
  entries?: never;
  version: 3; copyMode: "move"; sourceIdentity: RootIdentity; warning?: string;
}
type DirectoryMigrationJournal = LegacyDirectoryMigrationJournal | DirectDirectoryMigrationJournal | MoveDirectoryMigrationJournal;
export interface DirectoryMigrationProgress {
  phase: "checking" | "moving" | "copying" | "verifying" | "switching" | "cleaning" | "complete";
  message: string;
  mode?: "move" | "copy";
  totalFiles: number;
  completedFiles: number;
  totalBytes: number;
  completedBytes: number;
}
export interface DirectoryMigrationResult {
  projectRoot: string;
  changed: boolean;
  warning?: string;
}

// 暂时关闭 SHA-256 内容校验以缩短迁移时间；原校验实现保留，恢复时设为 true。
const VERIFY_MIGRATED_CONTENT = false;
const CLEANUP_MAX_RETRIES = 20;
const CLEANUP_RETRY_DELAY_MS = 250;

function inside(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function sameFileTime(left: number, right: number): boolean {
  return Math.abs(left - right) < 2;
}

/** 解析已有祖先的真实路径，防止通过 junction / symlink 绕过目录包含检查。 */
async function physicalPath(value: string): Promise<string> {
  let ancestor = path.resolve(value);
  const segments: string[] = [];
  while (!fs.existsSync(ancestor)) {
    segments.unshift(path.basename(ancestor));
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error("无法解析保存目录");
    ancestor = parent;
  }
  return path.join(await fs.promises.realpath(ancestor), ...segments);
}

export function writeMigrationJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function readDirectoryMigrationJournal(filePath: string): DirectoryMigrationJournal | null {
  if (!fs.existsSync(filePath)) return null;
  const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as any;
  const legacy = value.version === 1;
  const direct = value.version === 2 && value.copyMode === "direct" && typeof value.verifyContent === "boolean";
  const move = value.version === 3 && value.copyMode === "move"
    && value.sourceIdentity && typeof value.sourceIdentity.dev === "string"
    && typeof value.sourceIdentity.ino === "string" && Number.isFinite(value.sourceIdentity.birthtimeMs);
  if ((!legacy && !direct && !move) || !["moving", "copying", "verified", "published", "switched", "complete"].includes(value.phase)
    || ![value.source, value.target].every((item) => typeof item === "string" && path.isAbsolute(item))
    || inside(value.source, value.target) || inside(value.target, value.source)
    || (legacy && (typeof value.staging !== "string" || !path.isAbsolute(value.staging)
      || path.dirname(value.staging) !== path.dirname(value.target)
      || !/^\.robotconfig-migration-[0-9a-f-]{36}$/.test(path.basename(value.staging))
      || inside(value.source, value.staging) || inside(value.staging, value.source) || inside(value.target, value.staging)))
    || (!move && !Array.isArray(value.entries))
    || (move && value.phase !== "moving" && !["published", "switched", "complete"].includes(value.phase))
    || (!move && value.phase === "moving")) {
    throw new Error("目录迁移记录无效，请保留现场并检查 data-path-migration.json");
  }
  if (move) return value as MoveDirectoryMigrationJournal;
  if (!Array.isArray(value.entries)
    || new Set(value.entries.map((entry: Entry) => entry.relativePath)).size !== value.entries.length
    || value.entries.some((entry: Entry) => !entry.relativePath || path.isAbsolute(entry.relativePath)
      || path.resolve(value.source, entry.relativePath) === value.source
      || !inside(value.source, path.resolve(value.source, entry.relativePath))
      || typeof entry.directory !== "boolean" || !Number.isSafeInteger(entry.size) || entry.size < 0 || !Number.isFinite(entry.mtimeMs)
      || (entry.copyState !== undefined && entry.copyState !== "copying" && entry.copyState !== "copied")
      || (VERIFY_MIGRATED_CONTENT && value.verifyContent !== false && value.phase !== "copying" && !entry.directory && !/^[0-9a-f]{64}$/.test(entry.hash || "")))) {
    throw new Error("目录迁移记录无效，请保留现场并检查 data-path-migration.json");
  }
  return value as DirectoryMigrationJournal;
}

async function scan(root: string, relativePath = ""): Promise<Entry[]> {
  const result: Entry[] = [];
  for (const child of await fs.promises.readdir(path.join(root, relativePath), { withFileTypes: true })) {
    const relative = path.join(relativePath, child.name);
    const stat = await fs.promises.lstat(path.join(root, relative));
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      throw new Error(`项目数据包含链接或特殊文件，无法迁移：${relative}`);
    }
    result.push({ relativePath: relative, directory: stat.isDirectory(), size: stat.isDirectory() ? 0 : stat.size, mtimeMs: stat.mtimeMs });
    if (stat.isDirectory()) result.push(...await scan(root, relative));
  }
  return result.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function fileHash(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function matches(root: string, entries: Entry[], checkHash: boolean, checkTime = false): Promise<boolean> {
  if (!fs.existsSync(root)) return false;
  const actual = await scan(root);
  if (actual.length !== entries.length) return false;
  for (let i = 0; i < entries.length; i++) {
    const expected = entries[i];
    const current = actual[i];
    if (current.relativePath !== expected.relativePath || current.directory !== expected.directory || current.size !== expected.size
      || (checkTime && !current.directory && !sameFileTime(current.mtimeMs, expected.mtimeMs))) return false;
    if (checkHash && !expected.directory && (!expected.hash || await fileHash(path.join(root, expected.relativePath)) !== expected.hash)) return false;
  }
  return true;
}

/** 目标目录直接接收文件；校验已复制部分只允许台账中记录的路径。 */
async function validateDirectTarget(journal: DirectDirectoryMigrationJournal): Promise<boolean> {
  if (!fs.existsSync(journal.target)) return true;
  const actual = await scan(journal.target);
  const expected = new Map(journal.entries.map((entry) => [entry.relativePath, entry]));
  for (const item of actual) {
    const entry = expected.get(item.relativePath);
    if (!entry || entry.directory !== item.directory) return false;
    if (!item.directory) {
      if (entry.copyState === "copying") {
        if (item.size > entry.size) return false;
      } else if (entry.copyState === "copied") {
        if (item.size !== entry.size || !sameFileTime(item.mtimeMs, entry.mtimeMs)) return false;
      } else return false;
    }
  }
  return true;
}

async function clearDirectTarget(journal: DirectDirectoryMigrationJournal): Promise<void> {
  if (!fs.existsSync(journal.target)) return;
  if (!await validateDirectTarget(journal)) throw new Error("目标目录中出现未登记或已变化的文件，请检查后重试");
  for (const entry of journal.entries.filter((item) => !item.relativePath.includes(path.sep))) {
    await fs.promises.rm(path.join(journal.target, entry.relativePath), { recursive: entry.directory, force: true });
  }
}

async function rootIdentity(root: string): Promise<RootIdentity> {
  const stat = await fs.promises.stat(root, { bigint: true });
  return { dev: stat.dev.toString(), ino: stat.ino.toString(), birthtimeMs: Number(stat.birthtimeMs) };
}

function sameRootIdentity(left: RootIdentity, right: RootIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && Math.abs(left.birthtimeMs - right.birthtimeMs) < 2;
}

async function isEmptyDirectory(value: string): Promise<boolean> {
  if (!fs.existsSync(value)) return true;
  const stat = await fs.promises.lstat(value);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
  return (await fs.promises.readdir(value)).length === 0;
}

function assertJournalOutsideRoots(journalPath: string, source: string, target: string): void {
  const resolved = path.resolve(journalPath);
  if (inside(source, resolved) || inside(target, resolved)) {
    throw new Error("迁移记录不能保存在项目目录内，请使用独立的应用数据目录");
  }
}

async function resumeMovedDirectoryJournal(options: {
  source: string; target: string; journalPath: string; commitRoot: (target: string) => void;
  onProgress?: (progress: DirectoryMigrationProgress) => void;
}, currentRoot: string, journal: MoveDirectoryMigrationJournal): Promise<DirectoryMigrationResult> {
  const { source, target } = journal;
  assertJournalOutsideRoots(options.journalPath, source, target);
  if (inside(source, target) || inside(target, source)) throw new Error("新旧保存目录不能互相包含，请选择独立目录");
  const sourceExists = fs.existsSync(source);
  const targetExists = fs.existsSync(target);
  const sourceIsMigratedRoot = sourceExists && sameRootIdentity(journal.sourceIdentity, await rootIdentity(source));
  const targetIsMigratedRoot = targetExists && sameRootIdentity(journal.sourceIdentity, await rootIdentity(target));

  // 兼容旧版同卷移动已完成、但应用尚未更新配置的中断状态。
  if (targetIsMigratedRoot) {
    if (currentRoot !== target) options.commitRoot(target);
    journal.phase = "switched";
    writeMigrationJson(options.journalPath, journal);
    journal.phase = "complete";
    writeMigrationJson(options.journalPath, journal);
    return { projectRoot: target, changed: true };
  }

  if (!sourceIsMigratedRoot) {
    if (!sourceExists && !targetExists) throw new Error("迁移目录已丢失，请保留现场检查");
    throw new Error("未找到可恢复的项目目录，请保留现场检查");
  }

  if (targetExists && !await isEmptyDirectory(target)) {
    throw new Error("旧迁移目标目录已包含其他内容，未覆盖任何文件；请检查并清理目标目录后继续");
  }

  // 将旧版移动台账转为可续传的复制迁移。
  const copyJournal: DirectDirectoryMigrationJournal = {
    version: 2,
    copyMode: "direct",
    verifyContent: VERIFY_MIGRATED_CONTENT,
    source,
    target,
    phase: "copying",
    entries: await scan(source),
  };
  writeMigrationJson(options.journalPath, copyJournal);
  return migrateDirectDirectory(options, currentRoot, target, copyJournal);
}

export async function recoverMovedProjectDirectory(options: {
  currentRoot: string; journalPath: string; commitRoot: (target: string) => void;
}): Promise<string | null> {
  const journal = readDirectoryMigrationJournal(options.journalPath);
  if (!journal || journal.version !== 3 || journal.phase === "complete") return null;
  const sourceExists = fs.existsSync(journal.source);
  const targetExists = fs.existsSync(journal.target);
  if (targetExists && sameRootIdentity(journal.sourceIdentity, await rootIdentity(journal.target))) {
    if (options.currentRoot !== journal.target) options.commitRoot(journal.target);
    journal.phase = "switched";
    writeMigrationJson(options.journalPath, journal);
    journal.phase = "complete";
    writeMigrationJson(options.journalPath, journal);
    return journal.target;
  }
  if (sourceExists && sameRootIdentity(journal.sourceIdentity, await rootIdentity(journal.source))) return journal.source;
  if (!sourceExists && !targetExists) throw new Error("迁移目录已丢失，请保留现场检查");
  throw new Error("未找到可恢复的项目目录，请保留现场检查");
}

async function migrateDirectDirectory(options: {
  source: string; target: string; journalPath: string; commitRoot: (target: string) => void;
  onProgress?: (progress: DirectoryMigrationProgress) => void;
}, currentRoot: string, target: string, initialJournal?: DirectDirectoryMigrationJournal): Promise<DirectoryMigrationResult> {
  let journal = initialJournal;
  const reportProgress: DirectoryMigrationProgress = {
    phase: "checking", message: "正在检查保存目录", mode: "copy", totalFiles: 0, completedFiles: 0, totalBytes: 0, completedBytes: 0,
  };
  const report = () => { try { options.onProgress?.({ ...reportProgress }); } catch { /* window closed */ } };
  const phase = (value: DirectoryMigrationProgress["phase"], message: string) => {
    reportProgress.phase = value; reportProgress.message = message; report();
  };
  const source = journal?.source ?? currentRoot;
  if (inside(source, target) || inside(target, source)) throw new Error("新旧保存目录不能互相包含，请选择独立目录");
  if (!fs.existsSync(source) || !(await fs.promises.stat(source)).isDirectory()) throw new Error("原保存目录不存在，无法迁移");
  if (await physicalPath(source) !== source) throw new Error("原保存目录的实际路径已变化，请检查后重试");
  if (journal && currentRoot !== source && currentRoot !== target) throw new Error("迁移记录与当前保存目录不一致，请检查配置");
  if (!journal) {
    await fs.promises.mkdir(target, { recursive: true });
    if (!(await fs.promises.stat(target)).isDirectory() || (await fs.promises.readdir(target)).length) {
      throw new Error("目标保存目录必须为空，不能覆盖或合并已有项目");
    }
    journal = { version: 2, copyMode: "direct", verifyContent: VERIFY_MIGRATED_CONTENT, source, target, phase: "copying", entries: await scan(source) };
    writeMigrationJson(options.journalPath, journal);
  }
  reportProgress.totalFiles = journal.entries.filter((entry) => !entry.directory).length;
  reportProgress.totalBytes = journal.entries.filter((entry) => !entry.directory).reduce((sum, entry) => sum + entry.size, 0);
  // 关闭开关同时覆盖旧的直写迁移台账，避免恢复时重新启用内容校验。
  const checkHash = VERIFY_MIGRATED_CONTENT && journal.verifyContent;
  journal.verifyContent = checkHash;

  // 配置切换成功但台账尚未落盘时，以当前根路径识别已发布的新目录。
  if (currentRoot === target && (journal.phase === "verified" || journal.phase === "published")) journal.phase = "switched";

  if (journal.phase === "copying") {
    await fs.promises.mkdir(target, { recursive: true });
    if (!await validateDirectTarget(journal)) throw new Error("目标目录中出现未登记或已变化的文件，请检查后重试");
    if (!await matches(source, journal.entries, false, true)) {
      await clearDirectTarget(journal);
      journal.entries = await scan(source);
      writeMigrationJson(options.journalPath, journal);
    }
    phase("copying", "正在复制项目文件");
    for (const entry of journal.entries) {
      const destination = path.join(target, entry.relativePath);
      if (entry.directory) { await fs.promises.mkdir(destination, { recursive: true }); continue; }
      await fs.promises.mkdir(path.dirname(destination), { recursive: true });
      if (entry.copyState === "copied") {
        const existing = await fs.promises.stat(destination).catch((): null => null);
        if (!existing || existing.size !== entry.size || !sameFileTime(existing.mtimeMs, entry.mtimeMs)) {
          throw new Error(`目标文件已变化，无法安全续传：${entry.relativePath}`);
        }
        reportProgress.completedFiles += 1; reportProgress.completedBytes += entry.size; report();
        continue;
      }
      entry.copyState = "copying";
      writeMigrationJson(options.journalPath, journal);
      await fs.promises.rm(destination, { force: true });
      let lastReport = 0;
      const updateCopyProgress = (chunk: Buffer) => {
        reportProgress.completedBytes += chunk.length;
        if (Date.now() - lastReport >= 150) { lastReport = Date.now(); report(); }
      };
      if (checkHash) {
        const hash = createHash("sha256");
        await pipeline(fs.createReadStream(path.join(source, entry.relativePath)), new Transform({
          transform(chunk, _encoding, callback) { updateCopyProgress(chunk); hash.update(chunk); callback(null, chunk); },
        }), fs.createWriteStream(destination, { flags: "wx" }));
        entry.hash = hash.digest("hex");
      } else {
        const input = fs.createReadStream(path.join(source, entry.relativePath));
        input.on("data", (chunk) => updateCopyProgress(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        await pipeline(input, fs.createWriteStream(destination, { flags: "wx" }));
      }
      const sourceStat = await fs.promises.stat(path.join(source, entry.relativePath));
      const targetStat = await fs.promises.stat(destination);
      if (sourceStat.size !== entry.size || sourceStat.mtimeMs !== entry.mtimeMs || targetStat.size !== entry.size) {
        throw new Error(`复制期间源文件或目标文件已变化：${entry.relativePath}`);
      }
      await fs.promises.utimes(destination, new Date(entry.mtimeMs), new Date(entry.mtimeMs));
      entry.copyState = "copied";
      reportProgress.completedFiles += 1; report();
      writeMigrationJson(options.journalPath, journal);
    }
    phase("verifying", checkHash ? "正在校验项目文件" : "正在检查文件清单");
    if (!await matches(source, journal.entries, checkHash, true)) {
      throw new Error("校验失败：复制期间原目录内容发生变化，原保存目录仍保留，请重试");
    }
    if (!await matches(target, journal.entries, checkHash, true)) {
      throw new Error("复制结果检查失败，原保存目录仍保留，请重试");
    }
    journal.phase = "verified";
    writeMigrationJson(options.journalPath, journal);
  }

  if (journal.phase === "verified") {
    phase("switching", "正在发布新保存目录");
    if (!await matches(target, journal.entries, checkHash, true) || !await matches(source, journal.entries, checkHash, true)) {
      throw new Error("新旧目录检查失败，原保存目录仍保留");
    }
    journal.phase = "published";
    writeMigrationJson(options.journalPath, journal);
  }
  if (journal.phase === "published") {
    phase("switching", "正在更新保存目录配置");
    if (!await matches(target, journal.entries, checkHash, true)) {
      throw new Error("新保存目录已变化，请检查后重试");
    }
    if (!await matches(source, journal.entries, checkHash, true)) {
      // 配置仍指向旧目录时，可丢弃已登记的副本并按最新源文件重做；
      // 若配置已切换到目标目录，则上方会进入 switched 并保留新目录的后续编辑。
      await clearDirectTarget(journal);
      journal.entries = await scan(source);
      journal.phase = "copying";
      writeMigrationJson(options.journalPath, journal);
      return migrateDirectDirectory(options, currentRoot, target, journal);
    }
    options.commitRoot(target);
    journal.phase = "switched";
    writeMigrationJson(options.journalPath, journal);
  } else if (journal.phase === "switched" && currentRoot !== target) {
    throw new Error("迁移记录与当前保存目录不一致，请检查配置");
  }

  let warning: string | undefined;
  try {
    phase("cleaning", "正在清理原目录中的已迁移文件");
    if (fs.existsSync(source) && (await fs.promises.readdir(source)).length) {
      if (!await matches(source, journal.entries, checkHash, true)) throw new Error("原目录内容已变化，已保留原目录，请检查后手动清理");
      for (const entry of journal.entries.filter((item) => !item.relativePath.includes(path.sep))) {
        const entryPath = path.resolve(source, entry.relativePath);
        const resolved = await fs.promises.realpath(entryPath);
        if (entryPath === source || !inside(source, resolved) || resolved !== entryPath) throw new Error("原目录清理路径已变化");
        await fs.promises.rm(entryPath, {
          recursive: entry.directory, force: true,
          maxRetries: CLEANUP_MAX_RETRIES, retryDelay: CLEANUP_RETRY_DELAY_MS,
        });
      }
    }
  } catch (error) {
    warning = `项目文件已迁移到新目录；${error instanceof Error ? error.message : String(error)}`;
  }
  journal.phase = "complete";
  if (warning) journal.warning = warning;
  try { writeMigrationJson(options.journalPath, journal); } catch { /* 保留上次可恢复记录 */ }
  phase("complete", warning || "保存目录迁移完成");
  return { projectRoot: target, changed: true, ...(warning ? { warning } : {}) };
}

async function removeOwnedStaging(journal: LegacyDirectoryMigrationJournal): Promise<void> {
  if (!fs.existsSync(journal.staging)) return;
  const stat = await fs.promises.lstat(journal.staging);
  const resolved = await physicalPath(journal.staging);
  if (!stat.isDirectory() || stat.isSymbolicLink() || resolved !== journal.staging
    || path.dirname(resolved) !== path.dirname(journal.target)
    || !/^\.robotconfig-migration-[0-9a-f-]{36}$/.test(path.basename(resolved))) {
    throw new Error("迁移临时目录路径已变化，请检查后重试");
  }
  await fs.promises.rm(resolved, { recursive: true, force: true });
}

/**
 * 新迁移直接复制到目标目录；旧版临时目录迁移记录继续使用兼容恢复流程。
 * journal 独立于源目录保存；配置切换失败 / 进程中断后可继续同一迁移。
 * 不打开或修改任何数据库；项目内文件一律作为二进制文件迁移。
 */
export async function migrateProjectDirectory(options: {
  source: string;
  target: string;
  journalPath: string;
  commitRoot: (target: string) => void;
  onProgress?: (progress: DirectoryMigrationProgress) => void;
}): Promise<DirectoryMigrationResult> {
  const rawTarget = String(options.target ?? "").trim();
  if (!rawTarget || !path.isAbsolute(rawTarget)) throw new Error("请选择有效的绝对保存目录");
  const currentRoot = await physicalPath(options.source);
  const target = await physicalPath(rawTarget);
  let journal = readDirectoryMigrationJournal(options.journalPath);
  if (journal?.phase === "complete") journal = null;
  if (journal && (journal.target !== target || (journal.source !== currentRoot && journal.target !== currentRoot))) {
    throw new Error(`上次目录迁移尚未完成，请先继续迁移到：${journal.target}`);
  }
  if (!journal && path.relative(currentRoot, target) === "") return { projectRoot: currentRoot, changed: false };
  assertJournalOutsideRoots(options.journalPath, journal?.source ?? currentRoot, target);
  const source = journal?.source ?? currentRoot;
  if (inside(source, target) || inside(target, source)) throw new Error("新旧保存目录不能互相包含，请选择独立目录");
  if (await physicalPath(source) !== source || (journal?.version === 1 && await physicalPath(journal.staging) !== journal.staging)) {
    throw new Error("迁移目录的实际路径已变化，请检查后重试");
  }
  if (journal?.version === 3) return resumeMovedDirectoryJournal(options, currentRoot, journal);
  if (!journal || journal.version === 2) {
    return migrateDirectDirectory(options, currentRoot, target, journal?.version === 2 ? journal : undefined);
  }
  const progress: DirectoryMigrationProgress = {
    phase: "checking", message: "正在检查保存目录", mode: "copy", totalFiles: 0, completedFiles: 0, totalBytes: 0, completedBytes: 0,
  };
  let snapshotVerifiedThisRun = false;
  let targetVerifiedThisRun = false;
  // 进度监听器失败不能中断数据迁移。
  const report = () => { try { options.onProgress?.({ ...progress }); } catch { /* window closed */ } };
  const phase = (value: DirectoryMigrationProgress["phase"], message: string) => {
    progress.phase = value; progress.message = message; report();
  };
  report();
  if (!journal) {
    if (!fs.existsSync(source) || !(await fs.promises.stat(source)).isDirectory()) throw new Error("原保存目录不存在，无法迁移");
    await fs.promises.mkdir(target, { recursive: true });
    if (!(await fs.promises.stat(target)).isDirectory() || (await fs.promises.readdir(target)).length) {
      throw new Error("目标保存目录必须为空，不能覆盖或合并已有项目");
    }
    const staging = path.join(path.dirname(target), `.robotconfig-migration-${randomUUID()}`);
    journal = { version: 1, source, target, staging, phase: "copying", entries: await scan(source) };
    writeMigrationJson(options.journalPath, journal);
  }
  if (journal.version !== 1) throw new Error("迁移记录版本不支持，请保留现场检查");
  const legacyJournal = journal;
  // 恢复旧版迁移也遵循当前开关；SHA-256 实现保留，暂不计算或读取内容。
  const checkHash = VERIFY_MIGRATED_CONTENT && legacyJournal.verifyContent !== false;
  legacyJournal.verifyContent = checkHash;
  writeMigrationJson(options.journalPath, legacyJournal);
  const totalFiles = legacyJournal.entries.filter((entry) => !entry.directory);
  progress.totalFiles = totalFiles.length;
  progress.totalBytes = totalFiles.reduce((sum, entry) => sum + entry.size, 0);

  // 配置已经提交但台账尚未写入时，目标可能已有新的业务编辑，不能拿旧快照覆盖它。
  if (legacyJournal.phase === "published" && currentRoot === target) {
    legacyJournal.phase = "switched";
  }
  // 发布/回退的目录重命名完成后进程中断，先识别实际落盘状态。
  if (legacyJournal.phase === "published" && !fs.existsSync(target) && fs.existsSync(legacyJournal.staging)) {
    if (!await matches(legacyJournal.staging, legacyJournal.entries, checkHash, true)) throw new Error("迁移临时目录已变化，请保留现场检查");
    legacyJournal.phase = "verified";
  }
  if (legacyJournal.phase === "verified" && !fs.existsSync(legacyJournal.staging)) {
    if (!await matches(target, legacyJournal.entries, checkHash, true)) throw new Error("已发布目录校验失败，原目录仍保留");
    targetVerifiedThisRun = true;
    legacyJournal.phase = "published";
  }
  // 失败后用户可能继续编辑原项目；重试时重新复制最新内容，不提交过期快照。
  if ((legacyJournal.phase === "verified" || legacyJournal.phase === "published") && !await matches(source, legacyJournal.entries, checkHash, true)) {
    if (legacyJournal.phase === "published") {
      if (!await matches(target, legacyJournal.entries, checkHash, true) || fs.existsSync(legacyJournal.staging)) {
        throw new Error("新旧目录均有变化，请保留现场检查，不能自动覆盖");
      }
      await fs.promises.rename(target, legacyJournal.staging);
    }
    legacyJournal.phase = "copying";
    targetVerifiedThisRun = false;
    writeMigrationJson(options.journalPath, legacyJournal);
  }

  if (legacyJournal.phase === "copying") {
    // 中途复制失败时重新复制；原目录始终完整，目标目录尚未发布。
    if (fs.existsSync(target) && (await fs.promises.readdir(target)).length) throw new Error("目标目录已被写入，请恢复为空目录后继续迁移");
    await removeOwnedStaging(legacyJournal);
    legacyJournal.entries = await scan(source);
    writeMigrationJson(options.journalPath, legacyJournal);
    progress.totalFiles = legacyJournal.entries.filter((entry) => !entry.directory).length;
    progress.totalBytes = legacyJournal.entries.reduce((sum, entry) => sum + entry.size, 0);
    await fs.promises.mkdir(legacyJournal.staging);
    phase("copying", "正在复制项目文件");
    let lastReport = 0;
    for (const entry of legacyJournal.entries) {
      const destination = path.join(legacyJournal.staging, entry.relativePath);
      if (entry.directory) {
        await fs.promises.mkdir(destination, { recursive: true });
        continue;
      }
      await fs.promises.mkdir(path.dirname(destination), { recursive: true });
      const hash = checkHash ? createHash("sha256") : null;
      await pipeline(fs.createReadStream(path.join(source, entry.relativePath)), new Transform({
        transform(chunk, _encoding, callback) {
          hash?.update(chunk);
          progress.completedBytes += chunk.length;
          if (Date.now() - lastReport >= 150) { lastReport = Date.now(); report(); }
          callback(null, chunk);
        },
      }), fs.createWriteStream(destination, { flags: "wx" }));
      if (hash) entry.hash = hash.digest("hex");
      const stat = await fs.promises.stat(destination);
      if (stat.size !== entry.size) throw new Error(`复制期间源文件已变化：${entry.relativePath}`);
      // 保留文件时间，避免点云缓存依据 mtime 判断失效。
      await fs.promises.utimes(destination, new Date(entry.mtimeMs), new Date(entry.mtimeMs));
      progress.completedFiles += 1;
      report();
    }
    phase("verifying", checkHash ? "正在校验项目文件" : "正在检查文件清单");
    if (!await matches(source, legacyJournal.entries, checkHash, true) || !await matches(legacyJournal.staging, legacyJournal.entries, checkHash, true)) {
      throw new Error("文件校验失败或原目录发生变化，原保存目录仍保留，请重试");
    }
    targetVerifiedThisRun = true;
    snapshotVerifiedThisRun = true;
    legacyJournal.phase = "verified";
    writeMigrationJson(options.journalPath, legacyJournal);
  }
  progress.completedBytes = progress.totalBytes;
  progress.completedFiles = progress.totalFiles;

  if (legacyJournal.phase === "verified") {
    phase("switching", "正在发布新保存目录");
    if (!snapshotVerifiedThisRun
      && (!await matches(source, legacyJournal.entries, checkHash, true) || !await matches(legacyJournal.staging, legacyJournal.entries, checkHash, true))) {
      throw new Error("原目录或临时目录已变化，请保留现场检查后重试");
    }
    if (fs.existsSync(legacyJournal.staging)) {
      await fs.promises.mkdir(target, { recursive: true });
      if ((await fs.promises.readdir(target)).length) throw new Error("目标保存目录已非空，无法发布迁移结果");
      await fs.promises.rmdir(target); // 只移除已经确认为空的目标目录。
      await fs.promises.rename(legacyJournal.staging, target);
    }
    // 兼容发布完成但尚未来得及更新 journal 的进程中断。
    if (!targetVerifiedThisRun && !await matches(target, legacyJournal.entries, checkHash, true)) {
      throw new Error("新保存目录校验失败，原目录仍保留");
    }
    targetVerifiedThisRun = true;
    legacyJournal.phase = "published";
    writeMigrationJson(options.journalPath, legacyJournal);
  }
  if (legacyJournal.phase === "published") {
    phase("switching", "正在更新保存目录配置");
    if (!await matches(target, legacyJournal.entries, checkHash, true)) {
      throw new Error("新保存目录已变化，请检查后继续迁移");
    }
    if (!await matches(source, legacyJournal.entries, false, true)) {
      throw new Error("原保存目录已变化，请重试迁移最新文件");
    }
    options.commitRoot(target);
    legacyJournal.phase = "switched";
  } else if (legacyJournal.phase === "switched") {
    if (currentRoot !== target) throw new Error("迁移记录与当前保存目录不一致，请检查配置");
  }

  let warning: string | undefined;
  try {
    writeMigrationJson(options.journalPath, legacyJournal);
    phase("cleaning", "正在清理原目录中的已迁移文件");
    if (fs.existsSync(source) && (await fs.promises.readdir(source)).length) {
      // 先整树校验，任何外部改动都停止自动清理，避免删除新的文件。
      if (!await matches(source, legacyJournal.entries, checkHash, true)) {
        throw new Error("原目录内容已变化，已保留原目录，请检查后手动清理");
      }
      for (const entry of legacyJournal.entries.filter((item) => !item.relativePath.includes(path.sep))) {
        const entryPath = path.resolve(source, entry.relativePath);
        const resolved = await fs.promises.realpath(entryPath);
        if (entryPath === source || !inside(source, resolved) || resolved !== entryPath) throw new Error("原目录清理路径已变化");
        try {
          await fs.promises.rm(entryPath, {
            recursive: entry.directory, force: true,
            maxRetries: CLEANUP_MAX_RETRIES, retryDelay: CLEANUP_RETRY_DELAY_MS,
          });
        } catch (error) {
          // 清理失败后的部分源目录保留，后续由用户检查，不重复搬迁。
          throw new Error(`清理失败：${entry.relativePath}；${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    legacyJournal.phase = "complete";
    writeMigrationJson(options.journalPath, legacyJournal);
  } catch (error) {
    warning = `项目文件已迁移到新目录；${error instanceof Error ? error.message : String(error)}`;
    // 新目录已成为唯一工作目录，清理问题不能把成功迁移报告为失败。
    journal.phase = "complete";
    try { writeMigrationJson(options.journalPath, { ...legacyJournal, warning }); } catch { /* 保留上次可恢复记录 */ }
  }
  phase("complete", warning || "保存目录迁移完成");
  return { projectRoot: target, changed: true, ...(warning ? { warning } : {}) };
}
