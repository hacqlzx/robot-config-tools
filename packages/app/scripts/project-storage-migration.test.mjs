import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

async function loadTs(relative, transform = (source) => source) {
  const source = transform(fs.readFileSync(new URL(relative, import.meta.url), "utf8"));
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}
let fileSystemModuleId = 0;
async function loadMigrator(fileSystemOverrides = {}, transform = (source) => source) {
  const key = `__storageMigrationFileSystem${++fileSystemModuleId}`;
  globalThis[key] = {
    ...fs,
    ...fileSystemOverrides,
    promises: { ...fs.promises, ...fileSystemOverrides.promises },
  };
  try {
    return await loadTs("../electron/project-core/directory-migration.ts", (source) =>
      transform(source.replace('import fs from "node:fs";', `const fs = globalThis.${key};`)));
  } finally { delete globalThis[key]; }
}

// 原有用例继续覆盖跨卷复制；只拦截项目根 rename，旧版 staging 发布不受影响。
const { migrateProjectDirectory, recoverMovedProjectDirectory, readDirectoryMigrationJournal, writeMigrationJson } =
  await loadMigrator({ promises: { rename: async (source, target) => {
    if (path.basename(source) === "中文 原目录" && path.basename(target) === "新目录 带空格") {
      throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
    }
    return fs.promises.rename(source, target);
  } } });

function setup(t, migrator = migrateProjectDirectory) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "robotconfig-storage-test-"));
  const source = path.join(base, "中文 原目录");
  const target = path.join(base, "新目录 带空格");
  const journalPath = path.join(base, "配置", "data-path-migration.json");
  fs.mkdirSync(source);
  let root = source;
  t.after(() => {
    const resolved = path.resolve(base);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("robotconfig-storage-test-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const run = (extra = {}) => migrator({
    source: root, target, journalPath,
    commitRoot: (value) => { root = value; }, ...extra,
  });
  return { base, source, target, journalPath, run, root: () => root };
}

test("中文与空格路径：完整搬迁二进制、清单、空目录和隐藏缓存，保留项目 ID", async (t) => {
  const s = setup(t);
  const project = path.join(s.source, "厂站甲");
  fs.mkdirSync(path.join(project, "地图", "一号 地图"), { recursive: true });
  fs.mkdirSync(path.join(project, "空目录"));
  fs.mkdirSync(path.join(s.source, ".potree-converter-runtime"));
  const bytes = Buffer.from(Array.from({ length: 160000 }, (_, i) => i % 256));
  fs.writeFileSync(path.join(project, "地图", "一号 地图", "map.las"), bytes);
  fs.writeFileSync(path.join(project, "project.manifest.json"), '{"projectId":"stable-id","name":"厂站甲"}');
  const phases = [];
  let targetVisibleDuringCopy = false;
  const result = await s.run({ onProgress: (p) => {
    phases.push(p.phase);
    if (p.phase === "copying" && p.completedFiles > 0) targetVisibleDuringCopy = fs.readdirSync(s.target).length > 0;
  } });
  assert.equal(result.changed, true);
  assert.equal(result.warning, undefined);
  assert.deepEqual(fs.readFileSync(path.join(s.target, "厂站甲", "地图", "一号 地图", "map.las")), bytes);
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.target, "厂站甲", "project.manifest.json"), "utf8")).projectId, "stable-id");
  assert.ok(fs.statSync(path.join(s.target, "厂站甲", "空目录")).isDirectory());
  assert.deepEqual(fs.readdirSync(s.source), []);
  assert.equal(s.root(), s.target);
  assert.equal(readDirectoryMigrationJournal(s.journalPath).phase, "complete");
  assert.equal(readDirectoryMigrationJournal(s.journalPath).version, 2);
  assert.equal(readDirectoryMigrationJournal(s.journalPath).verifyContent, false);
  assert.ok(readDirectoryMigrationJournal(s.journalPath).entries.filter((entry) => !entry.directory).every((entry) => !entry.hash));
  assert.equal(targetVisibleDuringCopy, true);
  assert.ok(phases.includes("verifying") && phases.includes("cleaning"));
});

test("直接复制中断后依据台账续传目标目录中的部分文件", async (t) => {
  const s = setup(t);
  const first = path.join(s.source, "a.txt");
  const second = path.join(s.source, "b.txt");
  fs.writeFileSync(first, "first file");
  fs.writeFileSync(second, "second file content");
  fs.mkdirSync(s.target);
  const firstStat = fs.statSync(first);
  fs.writeFileSync(path.join(s.target, "a.txt"), "first file");
  fs.writeFileSync(path.join(s.target, "b.txt"), "second");
  fs.utimesSync(path.join(s.target, "a.txt"), firstStat.atime, firstStat.mtime);
  const secondStat = fs.statSync(second);
  writeMigrationJson(s.journalPath, {
    version: 2, copyMode: "direct", verifyContent: false,
    source: s.source, target: s.target, phase: "copying",
    entries: [
      { relativePath: "a.txt", directory: false, size: firstStat.size, mtimeMs: firstStat.mtimeMs, copyState: "copied" },
      { relativePath: "b.txt", directory: false, size: secondStat.size, mtimeMs: secondStat.mtimeMs, copyState: "copying" },
    ],
  });

  await s.run();

  assert.equal(fs.readFileSync(path.join(s.target, "a.txt"), "utf8"), "first file");
  assert.equal(fs.readFileSync(path.join(s.target, "b.txt"), "utf8"), "second file content");
  assert.equal(readDirectoryMigrationJournal(s.journalPath).phase, "complete");
  assert.deepEqual(fs.readdirSync(s.source), []);
});

test("旧版台账在复制、检查、发布及清理恢复时都跳过 SHA-256", async (t) => {
  const { migrateProjectDirectory: migrateWithoutHash } = await loadTs("../electron/project-core/directory-migration.ts", (source) =>
    source.replace('import { createHash, randomUUID } from "node:crypto";',
      'import { randomUUID } from "node:crypto"; const createHash = () => { throw new Error("不应执行 SHA-256"); };'));
  for (const state of ["copying", "verified", "published-before-journal", "published", "switched"]) {
    await t.test(state, async (child) => {
      const s = setup(child);
      const original = path.join(s.source, "地图.las");
      fs.writeFileSync(original, Buffer.alloc(160000, 42));
      const stat = fs.statSync(original);
      const staging = path.join(s.base, ".robotconfig-migration-00000000-0000-0000-0000-000000000000");
      const phase = state === "published-before-journal" ? "verified" : state;
      const destinationRoot = state === "copying" || state === "verified" ? staging : s.target;
      fs.mkdirSync(destinationRoot);
      fs.copyFileSync(original, path.join(destinationRoot, "地图.las"));
      fs.utimesSync(path.join(destinationRoot, "地图.las"), stat.atime, stat.mtime);
      writeMigrationJson(s.journalPath, {
        version: 1, source: s.source, target: s.target, staging, phase,
        // 故意使用不匹配的旧哈希，证明恢复时只读取文件元数据。
        entries: [{ relativePath: "地图.las", directory: false, size: stat.size, mtimeMs: stat.mtimeMs, hash: "0".repeat(64) }],
      });
      const progress = [];
      const result = await migrateWithoutHash({
        source: state === "switched" ? s.target : s.source, target: s.target, journalPath: s.journalPath,
        commitRoot: () => {}, onProgress: (p) => progress.push(p),
      });
      assert.equal(result.warning, undefined);
      assert.deepEqual(fs.readFileSync(path.join(s.target, "地图.las")), Buffer.alloc(160000, 42));
      assert.deepEqual(fs.readdirSync(s.source), []);
      assert.equal(readDirectoryMigrationJournal(s.journalPath).verifyContent, false);
      assert.ok(progress.every((p) => p.message !== "正在校验项目文件"));
    });
  }
});

test("已有直写台账开启校验时，当前关闭开关仍优先跳过 SHA-256", async (t) => {
  const s = setup(t);
  fs.writeFileSync(path.join(s.source, "文件"), "data");
  await assert.rejects(s.run({ commitRoot: () => { throw new Error("fail"); } }));
  const journal = readDirectoryMigrationJournal(s.journalPath);
  journal.verifyContent = true;
  for (const entry of journal.entries) if (!entry.directory) entry.hash = "0".repeat(64);
  writeMigrationJson(s.journalPath, journal);
  await s.run();
  assert.equal(readDirectoryMigrationJournal(s.journalPath).verifyContent, false);
  assert.equal(fs.readFileSync(path.join(s.target, "文件"), "utf8"), "data");
});

test("相同路径不触发搬迁；空根目录可迁移", async (t) => {
  const s = setup(t);
  assert.equal((await s.run({ target: s.source })).changed, false);
  assert.equal((await s.run()).changed, true);
  assert.deepEqual(fs.readdirSync(s.target), []);
});

test("拒绝包含关系、相对路径和非空目标，原目录/配置不变", async (t) => {
  const s = setup(t);
  fs.writeFileSync(path.join(s.source, "原文件"), "原内容");
  await assert.rejects(s.run({ target: path.join(s.source, "子目录") }), /互相包含/);
  await assert.rejects(s.run({ target: s.base }), /互相包含|迁移记录不能保存在项目目录内/);
  await assert.rejects(s.run({ target: "relative" }), /绝对/);
  fs.mkdirSync(s.target);
  fs.writeFileSync(path.join(s.target, "已有文件"), "不能覆盖");
  await assert.rejects(s.run(), /必须为空/);
  assert.equal(s.root(), s.source);
  assert.equal(fs.readFileSync(path.join(s.source, "原文件"), "utf8"), "原内容");
  assert.equal(fs.readFileSync(path.join(s.target, "已有文件"), "utf8"), "不能覆盖");
});

test("拒绝项目内目录链接及通过 junction 绕过包含关系", async (t) => {
  const s = setup(t);
  const external = path.join(s.base, "外部");
  fs.mkdirSync(external);
  fs.symlinkSync(external, path.join(s.source, "链接"), "junction");
  await assert.rejects(s.run(), /链接或特殊文件/);
  fs.unlinkSync(path.join(s.source, "链接"));
  const alias = path.join(s.base, "源别名");
  fs.symlinkSync(s.source, alias, "junction");
  await assert.rejects(s.run({ target: path.join(alias, "子目录") }), /互相包含/);
});

test("配置写入失败不删除原文件，同一目标可以恢复", async (t) => {
  const s = setup(t);
  fs.writeFileSync(path.join(s.source, "点表.xlsx"), "数据");
  await assert.rejects(s.run({ commitRoot: () => { throw new Error("配置写入失败"); } }), /配置写入失败/);
  assert.equal(s.root(), s.source);
  assert.equal(fs.readFileSync(path.join(s.source, "点表.xlsx"), "utf8"), "数据");
  assert.equal(readDirectoryMigrationJournal(s.journalPath).phase, "published");
  await assert.rejects(s.run({ target: path.join(s.base, "其他目标") }), /上次目录迁移/);
  await s.run();
  assert.equal(s.root(), s.target);
  assert.deepEqual(fs.readdirSync(s.source), []);
});

test("配置失败后原项目继续编辑，重试搬迁最新内容", async (t) => {
  const s = setup(t);
  fs.writeFileSync(path.join(s.source, "标定.json"), "旧内容");
  await assert.rejects(s.run({ commitRoot: () => { throw new Error("fail"); } }));
  fs.writeFileSync(path.join(s.source, "标定.json"), "新的标定内容");
  fs.writeFileSync(path.join(s.source, "新文件"), "新数据");
  await s.run();
  assert.equal(fs.readFileSync(path.join(s.target, "标定.json"), "utf8"), "新的标定内容");
  assert.equal(fs.readFileSync(path.join(s.target, "新文件"), "utf8"), "新数据");
});

test("复制期间外部改动阻止切换，重试重新复制", async (t) => {
  const s = setup(t);
  fs.writeFileSync(path.join(s.source, "地图"), "old");
  await assert.rejects(s.run({ onProgress: (p) => {
    if (p.phase === "verifying") fs.writeFileSync(path.join(s.source, "地图"), "new data");
  } }), /校验失败/);
  assert.equal(s.root(), s.source);
  assert.equal(readDirectoryMigrationJournal(s.journalPath).phase, "copying");
  await s.run();
  assert.equal(fs.readFileSync(path.join(s.target, "地图"), "utf8"), "new data");
});

test("已发布目标被外部编辑时拒绝覆盖", async (t) => {
  const s = setup(t);
  fs.writeFileSync(path.join(s.source, "文件"), "original");
  await assert.rejects(s.run({ commitRoot: () => { throw new Error("fail"); } }));
  fs.writeFileSync(path.join(s.target, "文件"), "target edited");
  await assert.rejects(s.run(), /新保存目录已变化/);
  assert.equal(s.root(), s.source);
  assert.equal(fs.readFileSync(path.join(s.target, "文件"), "utf8"), "target edited");
});

test("配置已提交而台账仍 published 时保留新目录后续编辑", async (t) => {
  const s = setup(t);
  fs.writeFileSync(path.join(s.source, "文件"), "original");
  await assert.rejects(s.run({ commitRoot: () => { throw new Error("fail"); } }));
  fs.writeFileSync(path.join(s.target, "文件"), "new edit");
  const result = await s.run({ source: s.target, commitRoot: () => assert.fail("不应重复提交") });
  assert.equal(result.warning, undefined);
  assert.equal(fs.readFileSync(path.join(s.target, "文件"), "utf8"), "new edit");
  assert.deepEqual(fs.readdirSync(s.source), []);
});

test("发布完成但 verified 台账未更新时可以恢复", async (t) => {
  const s = setup(t);
  fs.writeFileSync(path.join(s.source, "文件"), "data");
  await assert.rejects(s.run({ commitRoot: () => { throw new Error("fail"); } }));
  const journal = readDirectoryMigrationJournal(s.journalPath);
  journal.phase = "verified";
  writeMigrationJson(s.journalPath, journal);
  await s.run();
  assert.equal(fs.readFileSync(path.join(s.target, "文件"), "utf8"), "data");
});

test("提交后旧目录出现新文件时保留旧目录并报告清理警告", async (t) => {
  const s = setup(t);
  fs.writeFileSync(path.join(s.source, "文件"), "data");
  const result = await s.run({ commitRoot: () => {
    fs.writeFileSync(path.join(s.source, "外部新文件"), "保留");
  } });
  assert.match(result.warning, /已保留原目录/);
  assert.equal(fs.readFileSync(path.join(s.source, "外部新文件"), "utf8"), "保留");
  assert.equal(fs.readFileSync(path.join(s.target, "文件"), "utf8"), "data");
  assert.equal(readDirectoryMigrationJournal(s.journalPath).phase, "complete");
});

test("缺失源目录和越界/伪造台账拒绝操作", async (t) => {
  const s = setup(t);
  await assert.rejects(s.run({ source: path.join(s.base, "不存在") }), /原保存目录不存在/);
  const journal = {
    version: 1, source: s.source, target: s.target,
    staging: path.join(s.base, ".robotconfig-migration-00000000-0000-0000-0000-000000000000"),
    phase: "copying", entries: [{ relativePath: "../外部", directory: true, size: 0, mtimeMs: 0 }],
  };
  writeMigrationJson(s.journalPath, journal);
  assert.throws(() => readDirectoryMigrationJournal(s.journalPath), /无效/);
  journal.entries[0].relativePath = ".";
  writeMigrationJson(s.journalPath, journal);
  assert.throws(() => readDirectoryMigrationJournal(s.journalPath), /无效/);
});

test("同卷整体移动不读取文件内容，保留目录及文件 identity 和时间", async (t) => {
  const forbidCopy = () => assert.fail("同卷整体移动不应读取或复制文件内容");
  const { migrateProjectDirectory: move } = await loadMigrator({
    createReadStream: forbidCopy,
    createWriteStream: forbidCopy,
    promises: { copyFile: forbidCopy },
  });
  const s = setup(t, move);
  const project = path.join(s.source, "厂站甲");
  fs.mkdirSync(path.join(project, "地图", "中文 地图"), { recursive: true });
  fs.mkdirSync(path.join(project, "空目录"));
  fs.mkdirSync(path.join(s.source, ".隐藏缓存"));
  const sourceFile = path.join(project, "地图", "中文 地图", "map.las");
  const bytes = Buffer.alloc(160000, 37);
  fs.writeFileSync(sourceFile, bytes);
  fs.utimesSync(sourceFile, new Date("2024-01-02T03:04:05Z"), new Date("2024-01-02T03:04:05Z"));
  const rootStat = fs.statSync(s.source);
  const fileStat = fs.statSync(sourceFile);
  const phases = [];

  const result = await s.run({ onProgress: (progress) => phases.push(progress.phase) });

  assert.equal(result.changed, true);
  assert.equal(result.warning, undefined);
  assert.equal(s.root(), s.target);
  assert.equal(fs.existsSync(s.source), false);
  assert.equal(fs.statSync(s.target).ino, rootStat.ino);
  const movedFile = path.join(s.target, "厂站甲", "地图", "中文 地图", "map.las");
  assert.equal(fs.statSync(movedFile).ino, fileStat.ino);
  assert.equal(fs.statSync(movedFile).mtimeMs, fileStat.mtimeMs);
  assert.deepEqual(fs.readFileSync(movedFile), bytes);
  assert.ok(fs.statSync(path.join(s.target, "厂站甲", "空目录")).isDirectory());
  assert.ok(fs.statSync(path.join(s.target, ".隐藏缓存")).isDirectory());
  assert.equal(readDirectoryMigrationJournal(s.journalPath).phase, "complete");
  assert.ok(!phases.includes("copying"));
  assert.ok(!phases.includes("verifying"));
});

test("同卷移动替换已有空目标，禁止覆盖非空目标及源目录链接", async (t) => {
  const { migrateProjectDirectory: move } = await loadMigrator();
  const s = setup(t, move);
  fs.writeFileSync(path.join(s.source, "文件"), "data");
  fs.mkdirSync(s.target);
  await s.run();
  assert.equal(fs.readFileSync(path.join(s.target, "文件"), "utf8"), "data");
  assert.equal(fs.existsSync(s.source), false);

  const nonempty = setup(t, move);
  fs.writeFileSync(path.join(nonempty.source, "文件"), "source");
  fs.mkdirSync(nonempty.target);
  fs.writeFileSync(path.join(nonempty.target, "文件"), "destination");
  await assert.rejects(nonempty.run(), /必须为空/);
  assert.equal(fs.readFileSync(path.join(nonempty.source, "文件"), "utf8"), "source");
  assert.equal(fs.readFileSync(path.join(nonempty.target, "文件"), "utf8"), "destination");

  const linked = setup(t, move);
  const external = path.join(linked.base, "外部");
  fs.mkdirSync(external);
  fs.symlinkSync(external, path.join(linked.source, "链接"), "junction");
  await assert.rejects(linked.run(), /链接或特殊文件/);
  assert.equal(fs.existsSync(linked.source), true);
  assert.equal(fs.existsSync(path.join(linked.source, "链接")), true);
});

test("根目录 rename 报 EXDEV 自动转复制，普通权限错误不转复制", async (t) => {
  const s = setup(t);
  fs.writeFileSync(path.join(s.source, "文件"), "cross-volume data");
  await s.run();
  assert.equal(readDirectoryMigrationJournal(s.journalPath).version, 2);
  assert.equal(readDirectoryMigrationJournal(s.journalPath).copyMode, "direct");
  assert.equal(fs.readFileSync(path.join(s.target, "文件"), "utf8"), "cross-volume data");
  assert.deepEqual(fs.readdirSync(s.source), []);

  const { migrateProjectDirectory: denyMove } = await loadMigrator({
    createReadStream: () => assert.fail("普通权限错误不应自动启动复制"),
    createWriteStream: () => assert.fail("普通权限错误不应自动启动复制"),
    promises: { rename: async () => {
      throw Object.assign(new Error("目录被占用"), { code: "EACCES" });
    } },
  });
  const denied = setup(t, denyMove);
  fs.writeFileSync(path.join(denied.source, "文件"), "original");
  await assert.rejects(denied.run(), /目录被占用|移动失败/);
  assert.equal(denied.root(), denied.source);
  assert.equal(fs.readFileSync(path.join(denied.source, "文件"), "utf8"), "original");
  assert.equal(fs.existsSync(path.join(denied.target, "文件")), false);
});

test("同卷移动的配置保存失败回滚到旧目录，同一迁移可重试", async (t) => {
  const { migrateProjectDirectory: move } = await loadMigrator();
  const s = setup(t, move);
  fs.writeFileSync(path.join(s.source, "标定.json"), "original");
  const fileIdentity = fs.statSync(path.join(s.source, "标定.json")).ino;

  await assert.rejects(s.run({ commitRoot: () => { throw new Error("配置保存失败"); } }), /配置保存失败/);

  assert.equal(s.root(), s.source);
  assert.equal(fs.readFileSync(path.join(s.source, "标定.json"), "utf8"), "original");
  assert.equal(fs.statSync(path.join(s.source, "标定.json")).ino, fileIdentity);
  assert.equal(fs.existsSync(path.join(s.target, "标定.json")), false);
  assert.notEqual(readDirectoryMigrationJournal(s.journalPath).phase, "complete");
  fs.writeFileSync(path.join(s.source, "标定.json"), "edited after failure");
  await s.run();
  assert.equal(fs.readFileSync(path.join(s.target, "标定.json"), "utf8"), "edited after failure");
  assert.equal(s.root(), s.target);
  assert.equal(fs.existsSync(s.source), false);
});

test("启动恢复：移动已完成但台账仍为 moving 时补提交目标，不创建空源目录", async (t) => {
  const s = setup(t);
  fs.writeFileSync(path.join(s.source, "文件"), "data");
  const identity = fs.statSync(s.source, { bigint: true });
  fs.renameSync(s.source, s.target);
  writeMigrationJson(s.journalPath, {
    version: 3, copyMode: "move", source: s.source, target: s.target, phase: "moving",
    sourceIdentity: { dev: identity.dev.toString(), ino: identity.ino.toString(), birthtimeMs: Number(identity.birthtimeMs) },
  });
  let committed;
  const recovered = await recoverMovedProjectDirectory({
    currentRoot: s.source, journalPath: s.journalPath, commitRoot: (root) => { committed = root; },
  });
  assert.equal(recovered, s.target);
  assert.equal(committed, s.target);
  assert.equal(fs.existsSync(s.source), false);
  assert.equal(fs.readFileSync(path.join(s.target, "文件"), "utf8"), "data");
  assert.equal(readDirectoryMigrationJournal(s.journalPath).phase, "complete");
});

test("启动恢复：未移动或已回滚时保留源目录；目录状态歧义或 identity 不匹配拒绝", async (t) => {
  const s = setup(t);
  fs.writeFileSync(path.join(s.source, "文件"), "source");
  const identity = fs.statSync(s.source, { bigint: true });
  const journal = {
    version: 3, copyMode: "move", source: s.source, target: s.target, phase: "moving",
    sourceIdentity: { dev: identity.dev.toString(), ino: identity.ino.toString(), birthtimeMs: Number(identity.birthtimeMs) },
  };
  writeMigrationJson(s.journalPath, journal);
  let committed = false;
  const unchanged = await recoverMovedProjectDirectory({ currentRoot: s.source, journalPath: s.journalPath, commitRoot: () => { committed = true; } });
  assert.equal(unchanged, s.source);
  assert.equal(committed, false);
  assert.equal(fs.readFileSync(path.join(s.source, "文件"), "utf8"), "source");

  fs.mkdirSync(s.target);
  await assert.rejects(recoverMovedProjectDirectory({ currentRoot: s.source, journalPath: s.journalPath, commitRoot: () => {} }), /同时存在/);
  fs.rmSync(s.target, { recursive: true, force: true });
  journal.sourceIdentity = { ...journal.sourceIdentity, ino: "-1" };
  writeMigrationJson(s.journalPath, journal);
  await assert.rejects(recoverMovedProjectDirectory({ currentRoot: s.source, journalPath: s.journalPath, commitRoot: () => {} }), /未找到可恢复/);
});

test("后台任务与迁移互斥，异步处理完成/异常后释放锁", async () => {
  const handlers = new Map();
  globalThis.__storageTestIpc = { handle: (channel, fn) => handlers.set(channel, fn) };
  const { beginProjectOperation, beginProjectDirectoryMigration, registerProjectActivityHandler } =
    await loadTs("../electron/project-core/project-activity.ts", (s) =>
      s.replace('import { ipcMain, type IpcMainInvokeEvent } from "electron";', 'const ipcMain = globalThis.__storageTestIpc; type IpcMainInvokeEvent = unknown;'));
  delete globalThis.__storageTestIpc;
  const releaseOperation = beginProjectOperation("导出");
  assert.throws(() => beginProjectDirectoryMigration(), /正在读取/);
  releaseOperation();
  const releaseMigration = beginProjectDirectoryMigration();
  assert.throws(() => beginProjectOperation("写入"), /正在迁移/);
  releaseMigration();
  let finish;
  registerProjectActivityHandler("test", async () => await new Promise((resolve) => { finish = resolve; }));
  const operation = handlers.get("test")({});
  assert.throws(() => beginProjectDirectoryMigration(), /正在读取/);
  finish();
  await operation;
  beginProjectDirectoryMigration()();
  registerProjectActivityHandler("fail", async () => { throw new Error("fail"); });
  await assert.rejects(handlers.get("fail")({}), /fail/);
  beginProjectDirectoryMigration()();
});
