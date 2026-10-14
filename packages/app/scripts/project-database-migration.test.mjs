import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import vm from "node:vm";
import { execFileSync } from "node:child_process";

const appDir = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");
const runtimeDir = fs.mkdtempSync(path.join(appDir, "node_modules", ".database-migration-test-"));
const runtimeFile = path.join(runtimeDir, "runtime.mjs");
const handlers = new Map();
globalThis.__projectDatabaseTestHandlers = handlers;
const result = await build({
  stdin: {
    contents: `
      export * from "@robot/database";
      export * from "./electron/project-core/project-database-migration";
      export * from "./electron/project-core/project-database";
      export * from "./electron/project-core/project-service";
      export * from "./electron/project-core/project-root";
      export * from "./electron/project-core/project-activity";
      export * from "./electron/db-ipc";
      export * from "./electron/normal-annotation-export";
    `,
    resolveDir: appDir,
  },
  bundle: true, format: "esm", platform: "node", packages: "external", write: false,
  plugins: [{ name: "test-electron", setup(builder) {
    builder.onResolve({ filter: /^@robot\/database$/ }, () => ({ path: path.resolve(appDir, "../database/src/index.ts") }));
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "test" }));
    builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: `
      export const app = { isPackaged: false, getPath: () => globalThis.__projectDatabaseTestUserData };
      export const shell = { showItemInFolder() {} };
      export const ipcMain = { handle: (name, handler) => globalThis.__projectDatabaseTestHandlers.set(name, handler) };
    ` }));
  } }],
});
fs.writeFileSync(runtimeFile, result.outputFiles[0].contents);
const api = await import(pathToFileURL(runtimeFile));
after(async () => {
  await api.closeAllProjectDatabases();
  assert.equal(path.dirname(runtimeDir), path.join(appDir, "node_modules"));
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  delete globalThis.__projectDatabaseTestHandlers;
  delete globalThis.__projectDatabaseTestUserData;
});

function setup(t, names = ["中文 项目甲", "项目乙"]) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "robotconfig-database-test-"));
  const root = path.join(base, "项目 存储");
  const userData = path.join(base, "配置");
  fs.mkdirSync(root);
  fs.mkdirSync(userData);
  fs.writeFileSync(path.join(userData, "data-path.json"), JSON.stringify({ projectRoot: root }));
  globalThis.__projectDatabaseTestUserData = userData;
  api.loadInitialProjectRoot();
  for (const name of names) fs.mkdirSync(path.join(root, name));
  const options = { projectRoot: root, legacyDatabasePath: path.join(base, "旧总库.db"), journalPath: path.join(userData, "split.json") };
  t.after(async () => {
    await api.closeAllProjectDatabases();
    assert.equal(path.dirname(base), path.resolve(os.tmpdir()));
    assert.ok(path.basename(base).startsWith("robotconfig-database-test-"));
    fs.rmSync(base, { recursive: true, force: true });
  });
  return { base, root, names, userData, options, run: () => api.migrateLegacyProjectDatabases(options),
    dbPath: (name) => path.join(root, name, "database", "robot-config.db") };
}

async function seed(s, alter = () => {}) {
  const db = await api.openDatabaseAtPath(s.options.legacyDatabasePath);
  try {
  // 使用真实旧版本 001–005 建库，让源库在内存升级路径也得到验证。
  api.runMigrations(db, [1, 2, 3, 4, 5].map((n) => {
    const prefix = `migration00${n}`;
    return { version: api[prefix + "Version"], name: api[prefix + "Name"], up: api[prefix + "Up"], down: api[prefix + "Down"] };
  }));
  for (const [index, name] of s.names.entries()) {
    const id = index * 100 + 10;
    db.prepare("INSERT INTO project_station (id, project_name, station_name) VALUES (?, ?, ?)").run(id, name, "测试厂站");
    db.prepare("INSERT INTO device_voltage (id, volt_name, project_name) VALUES (?, ?, ?)").run(id, "电压区", name);
    db.prepare("INSERT INTO device_bay (id, volt_id, project_name) VALUES (?, ?, ?)").run(id, id, name);
    db.prepare("INSERT INTO device_main (id, bay_id, volt_id, project_name) VALUES (?, ?, ?, ?)").run(id, id, id, name);
    db.prepare("INSERT INTO device_component (id, main_device_id, bay_id, volt_id, project_name) VALUES (?, ?, ?, ?, ?)").run(id, id, id, id, name);
    db.prepare("INSERT INTO device_point (id, point_code, point_name, calibration_id, component_id, main_device_id, bay_id, volt_id, project_name, cruise_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)")
      .run(id, "共享编码", "测试点位", String(id + 7), id, id, id, id, name);
  }
  db.prepare("UPDATE sqlite_sequence SET seq = 900").run();
  db.prepare("UPDATE calibration_sequence SET next_id = 123456 WHERE id = 1").run();
  alter(db);
  db.close();
  } catch (error) { db.discardAndClose(); throw error; }
  return fs.readFileSync(s.options.legacyDatabasePath);
}

// 每次使用新的 Node 进程启动真实数据库/IPC 初始化，避免内存缓存掩盖重启问题。
function runIsolatedStartup(s, projectName) {
  const script = `
    import { pathToFileURL } from "node:url";
    globalThis.__projectDatabaseTestHandlers = new Map();
    globalThis.__projectDatabaseTestUserData = process.argv[3];
    const api = await import(pathToFileURL(process.argv[1]));
    api.loadInitialProjectRoot();
    await api.initDbIpc(JSON.parse(process.argv[2]));
    const session = await api.openProjectDatabase(process.argv[4]);
    const points = await api.withProjectDatabaseSession(session.projectName, session.sessionVersion,
      (db) => db.prepare("SELECT id, project_name, point_code, point_name, calibration_id FROM device_point ORDER BY id").all());
    await api.closeAllProjectDatabases();
    process.stdout.write("SCENARIO_RESULT=" + JSON.stringify({ points,
      ipcReady: globalThis.__projectDatabaseTestHandlers.has("db:point:list") }) + "\\n");
  `;
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", script,
    runtimeFile, JSON.stringify(s.options), s.userData, projectName], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  const report = output.split(/\r?\n/).find((line) => line.startsWith("SCENARIO_RESULT="));
  assert.ok(report, "独立进程应正常完成初始化、打开项目并输出结果");
  return JSON.parse(report.slice("SCENARIO_RESULT=".length));
}

test("自动拆分保留六张表的原始字段、主键、关联、标定 ID 和序列；源库不变", async (t) => {
  const s = setup(t);
  const original = await seed(s);
  await s.run();
  assert.deepEqual(fs.readFileSync(s.options.legacyDatabasePath), original);
  const journal = JSON.parse(fs.readFileSync(s.options.journalPath));
  assert.equal(journal.phase, "complete");
  for (const [index, name] of s.names.entries()) {
    const db = await api.openDatabaseAtPath(s.dbPath(name), false);
    const source = await api.openDatabaseAtPath(s.options.legacyDatabasePath, false, false);
    try {
      for (const table of ["project_station", "device_voltage", "device_bay", "device_main", "device_component", "device_point"]) {
        assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(), source.prepare(`SELECT * FROM ${table} WHERE project_name = ?`).all(name));
      }
      assert.throws(() => source.saveToDisk(), /禁止写回源文件/);
      const point = db.prepare("SELECT * FROM device_point").all();
      assert.equal(point.length, 1);
      assert.equal(point[0].id, index * 100 + 10);
      assert.equal(point[0].componentId, point[0].id);
      assert.equal(point[0].calibrationId, String(point[0].id + 7));
      assert.equal(point[0].projectName, name);
      assert.equal(db.prepare("SELECT next_id FROM calibration_sequence").get().nextId, 123456);
      assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'project_station'").get().seq, 900);
      assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'device_point'").get().seq, 900);
      assert.equal(db.prepare("SELECT MAX(version) AS version FROM schema_version").get().version, 7);
      assert.equal(Object.values(db.prepare("PRAGMA integrity_check").get())[0], "ok");
    } finally { db.discardAndClose(); source.discardAndClose(); }
  }
});

test("空项目名中止整批预检，不发布项目库，不修改源库", async (t) => {
  for (const invalidName of [null, "", "   "]) {
    const s = setup(t);
    const original = await seed(s, (db) => db.prepare("UPDATE device_point SET project_name = ? WHERE id = 10").run(invalidName));
    await assert.rejects(s.run(), /旧总库预检失败/);
    assert.deepEqual(fs.readFileSync(s.options.legacyDatabasePath), original);
    assert.equal(fs.existsSync(s.options.journalPath), false);
    assert.equal(fs.existsSync(s.dbPath(s.names[0])), false);
  }
});

test("旧项目目录已删除时跳过并记录六张表行数，其他项目正常迁移且重启不重建目录", async (t) => {
  const s = setup(t);
  const original = await seed(s);
  const missingDirectory = path.join(s.root, s.names[0]);
  fs.rmdirSync(missingDirectory);
  await s.run();
  const journal = JSON.parse(fs.readFileSync(s.options.journalPath));
  assert.equal(journal.phase, "complete");
  assert.deepEqual(journal.skippedProjects, [{
    projectName: s.names[0], reason: "missing-project-directory",
    rowCounts: { project_station: 1, device_voltage: 1, device_bay: 1, device_main: 1, device_component: 1, device_point: 1 },
  }]);
  assert.deepEqual(journal.projects.map((record) => [record.projectName, record.status]), [[s.names[1], "complete"]]);
  const db = await api.openDatabaseAtPath(s.dbPath(s.names[1]), false, false);
  try {
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM device_point").get().count, 1);
    assert.equal(db.prepare("SELECT project_name FROM device_point").get().projectName, s.names[1]);
    assert.equal(db.prepare("SELECT component_id FROM device_point").get().componentId, 110);
  } finally { db.discardAndClose(); }
  const migrated = fs.readFileSync(s.dbPath(s.names[1]));
  await s.run();
  assert.equal(fs.existsSync(missingDirectory), false);
  assert.deepEqual(fs.readFileSync(s.dbPath(s.names[1])), migrated);
  assert.deepEqual(fs.readFileSync(s.options.legacyDatabasePath), original);
});

test("旧项目目录全部删除也可完成启动，源库及跳过记录保留", async (t) => {
  const s = setup(t);
  const original = await seed(s);
  for (const name of s.names) fs.rmdirSync(path.join(s.root, name));
  await s.run();
  const journal = JSON.parse(fs.readFileSync(s.options.journalPath));
  assert.equal(journal.phase, "complete");
  assert.deepEqual(journal.projects, []);
  assert.deepEqual(journal.skippedProjects.map((record) => record.projectName).sort(), [...s.names].sort());
  await s.run();
  assert.deepEqual(fs.readdirSync(s.root), []);
  assert.deepEqual(fs.readFileSync(s.options.legacyDatabasePath), original);
});

test("未完成旧台账中的项目目录被删除时标记跳过，继续校验剩余项目", async (t) => {
  const s = setup(t);
  const original = await seed(s);
  await s.run();
  const journal = JSON.parse(fs.readFileSync(s.options.journalPath));
  journal.phase = "splitting";
  delete journal.skippedProjects; // 兼容没有跳过字段的旧版 version 1 台账。
  fs.writeFileSync(s.options.journalPath, JSON.stringify(journal));
  const missingDirectory = path.join(s.root, s.names[0]);
  fs.rmSync(missingDirectory, { recursive: true });
  const migrated = fs.readFileSync(s.dbPath(s.names[1]));
  await s.run();
  const resumed = JSON.parse(fs.readFileSync(s.options.journalPath));
  assert.equal(resumed.phase, "complete");
  assert.equal(resumed.projects.find((record) => record.projectName === s.names[0]).status, "skipped");
  assert.equal(resumed.skippedProjects[0].projectName, s.names[0]);
  assert.equal(fs.existsSync(missingDirectory), false);
  assert.deepEqual(fs.readFileSync(s.dbPath(s.names[1])), migrated);
  assert.deepEqual(fs.readFileSync(s.options.legacyDatabasePath), original);
});

test("未完成批次中跳过的目录恢复后重新校验，身份冲突仍拒绝覆盖", async (t) => {
  const s = setup(t);
  const original = await seed(s);
  await s.run();
  const journal = JSON.parse(fs.readFileSync(s.options.journalPath));
  journal.phase = "splitting";
  journal.projects[0].status = "skipped";
  fs.writeFileSync(s.options.journalPath, JSON.stringify(journal));
  const migrated = fs.readFileSync(s.dbPath(s.names[0]));
  await s.run();
  const resumed = JSON.parse(fs.readFileSync(s.options.journalPath));
  assert.equal(resumed.phase, "complete");
  assert.ok(resumed.projects.every((record) => record.status === "complete"));
  assert.deepEqual(resumed.skippedProjects, []);
  assert.deepEqual(fs.readFileSync(s.dbPath(s.names[0])), migrated);
  const manifestFile = path.join(s.root, s.names[0], "project.manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile));
  manifest.project.id = "different-project-id";
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  fs.writeFileSync(s.options.journalPath, JSON.stringify(journal));
  await assert.rejects(s.run(), /与迁移台账不匹配/);
  assert.deepEqual(fs.readFileSync(s.dbPath(s.names[0])), migrated);
  assert.deepEqual(fs.readFileSync(s.options.legacyDatabasePath), original);
});

test("跨项目关联和同项目重复点位拒绝发布；已经完成的项目不重复写入", async (t) => {
  const s = setup(t);
  const original = await seed(s, (db) => db.prepare("UPDATE device_point SET component_id = 10 WHERE id = 110").run());
  await assert.rejects(s.run(), /跨表关联缺失/);
  const first = fs.readFileSync(s.dbPath(s.names[0]));
  await assert.rejects(s.run(), /跨表关联缺失/);
  assert.deepEqual(fs.readFileSync(s.dbPath(s.names[0])), first);
  assert.equal(fs.existsSync(s.dbPath(s.names[1])), false);
  assert.deepEqual(fs.readFileSync(s.options.legacyDatabasePath), original);
  const duplicate = setup(t, ["重复项目"]);
  await seed(duplicate, (db) => db.prepare("INSERT INTO device_point (point_code, project_name, cruise_id) VALUES (?, ?, 0)").run("共享编码", duplicate.names[0]));
  await assert.rejects(duplicate.run(), /UNIQUE constraint/);
  assert.equal(fs.existsSync(duplicate.dbPath(duplicate.names[0])), false);
});

test("发布后、清单/台账写入前中断可恢复；已有其他批次库禁止覆盖", async (t) => {
  const s = setup(t);
  await seed(s);
  await s.run();
  const bytes = fs.readFileSync(s.dbPath(s.names[0]));
  const journal = JSON.parse(fs.readFileSync(s.options.journalPath));
  journal.phase = "splitting";
  journal.projects[0].status = "copying";
  fs.writeFileSync(s.options.journalPath, JSON.stringify(journal));
  const manifestFile = path.join(s.root, s.names[0], "project.manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile));
  delete manifest.database;
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  await s.run();
  assert.equal(JSON.parse(fs.readFileSync(s.options.journalPath)).phase, "complete");
  assert.deepEqual(fs.readFileSync(s.dbPath(s.names[0])), bytes);
  journal.projects[0].status = "pending";
  journal.batchId = "other-batch";
  fs.writeFileSync(s.options.journalPath, JSON.stringify(journal));
  await assert.rejects(s.run(), /拒绝覆盖/);
  assert.deepEqual(fs.readFileSync(s.dbPath(s.names[0])), bytes);
});

test("完成后重命名、删除、新建、旧库删除/变化均不重新拆分；缺库拒绝空建", async (t) => {
  const s = setup(t);
  await seed(s);
  await s.run();
  await api.openProjectDatabase(s.names[0]);
  await api.renameProject(s.names[0], "重命名 项目");
  assert.equal(fs.existsSync(path.join(s.root, s.names[0])), false);
  await api.openProjectDatabase("重命名 项目");
  await api.deleteProject(s.names[1]);
  await api.createProject("全新项目");
  assert.equal((await api.getProjectDatabaseSummary("全新项目")).total, 0);
  await s.run();
  fs.writeFileSync(s.options.legacyDatabasePath, "已变化的旧备份");
  await s.run();
  fs.rmSync(s.options.legacyDatabasePath);
  await s.run();
  assert.equal(fs.existsSync(path.join(s.root, s.names[1])), false);
  await api.closeAllProjectDatabases();
  const newDb = s.dbPath("全新项目");
  fs.rmSync(newDb);
  await assert.rejects(s.run(), /项目数据库缺失/);
  await assert.rejects(api.openProjectDatabase("全新项目"), /项目数据库缺失/);
  assert.equal(fs.existsSync(newDb), false);
});

test("已迁移项目删除后新建同名项目，身份独立且后续启动不会重新导入旧数据", async (t) => {
  const s = setup(t, ["同名 项目"]);
  const original = await seed(s);
  await s.run();
  const oldIdentity = JSON.parse(fs.readFileSync(path.join(s.root, s.names[0], "project.manifest.json"))).project.id;
  const completedJournal = fs.readFileSync(s.options.journalPath);
  await api.deleteProject(s.names[0]);
  await api.createProject(s.names[0]);
  const newManifest = JSON.parse(fs.readFileSync(path.join(s.root, s.names[0], "project.manifest.json")));
  assert.notEqual(newManifest.project.id, oldIdentity);
  assert.equal(newManifest.database.migrationBatchId, null);
  for (let restart = 0; restart < 2; restart++) {
    await s.run();
    assert.equal((await api.getProjectDatabaseSummary(s.names[0])).total, 0);
  }
  assert.deepEqual(fs.readFileSync(s.options.journalPath), completedJournal);
  assert.deepEqual(fs.readFileSync(s.options.legacyDatabasePath), original);
});

test("旧目录已跳过后新建同名项目不回填旧数据，包括原目录全部被删除的情况", async (t) => {
  for (const deleteAll of [false, true]) {
    const s = setup(t);
    const original = await seed(s);
    for (const name of deleteAll ? s.names : [s.names[0]]) fs.rmdirSync(path.join(s.root, name));
    await s.run();
    const completedJournal = fs.readFileSync(s.options.journalPath);
    await api.createProject(s.names[0]);
    await s.run();
    await s.run();
    assert.equal((await api.getProjectDatabaseSummary(s.names[0])).total, 0);
    assert.deepEqual(fs.readFileSync(s.options.journalPath), completedJournal);
    assert.deepEqual(fs.readFileSync(s.options.legacyDatabasePath), original);
  }
});

test("没有台账但所有项目库有效时持久化完成标记，之后缺库不回退旧库拆分", async (t) => {
  const s = setup(t, ["同名 项目"]);
  const original = await seed(s);
  await s.run();
  fs.rmSync(s.options.journalPath);
  await s.run();
  const journal = JSON.parse(fs.readFileSync(s.options.journalPath));
  assert.equal(journal.phase, "complete");
  assert.equal(journal.sourceFingerprint, null);
  const manifestFile = path.join(s.root, s.names[0], "project.manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile));
  delete manifest.database;
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  await s.run(); // 新初始化批次也兼容从有效项目库补回清单。
  assert.ok(JSON.parse(fs.readFileSync(manifestFile)).database);
  fs.rmSync(s.dbPath(s.names[0]));
  await assert.rejects(s.run(), /项目数据库缺失/);
  assert.equal(fs.existsSync(s.dbPath(s.names[0])), false);
  assert.deepEqual(fs.readFileSync(s.options.legacyDatabasePath), original);
});

test("全新安装没有旧库时同样记录完成，后来出现旧备份不影响新建同名项目", async (t) => {
  const s = setup(t, []);
  await s.run();
  const completedJournal = fs.readFileSync(s.options.journalPath);
  const journal = JSON.parse(completedJournal);
  assert.equal(journal.phase, "complete");
  assert.equal(journal.sourceFingerprint, null);
  assert.deepEqual(journal.projects, []);
  s.names.push("后来同名");
  await api.createProject(s.names[0]);
  const original = await seed(s);
  await s.run();
  assert.equal((await api.getProjectDatabaseSummary(s.names[0])).total, 0);
  assert.deepEqual(fs.readFileSync(s.options.legacyDatabasePath), original);
  fs.writeFileSync(s.options.legacyDatabasePath, "此后不再读取的旧备份");
  await s.run();
  assert.equal((await api.getProjectDatabaseSummary(s.names[0])).total, 0);
  assert.deepEqual(fs.readFileSync(s.options.journalPath), completedJournal);
  assert.equal(fs.readFileSync(s.options.legacyDatabasePath, "utf8"), "此后不再读取的旧备份");
});

test("客户场景独立进程模拟：test/智洋培训目录缺失，当次启动成功，同名新项目编辑后再次启动不回填", async (t) => {
  const s = setup(t, ["test", "智洋培训", "正常项目"]);
  const original = await seed(s);
  for (const name of s.names.slice(0, 2)) fs.rmdirSync(path.join(s.root, name));
  const first = runIsolatedStartup(s, "正常项目");
  assert.equal(first.ipcReady, true);
  assert.equal(first.points.length, 1);
  assert.equal(first.points[0].id, 210);
  assert.equal(first.points[0].calibrationId, "217");
  const completedJournal = fs.readFileSync(s.options.journalPath);
  const journal = JSON.parse(completedJournal);
  assert.equal(journal.phase, "complete");
  assert.deepEqual(journal.skippedProjects.map((record) => record.projectName).sort(), ["test", "智洋培训"].sort());
  for (const name of s.names.slice(0, 2)) assert.equal(fs.existsSync(path.join(s.root, name)), false);
  const normalDatabase = fs.readFileSync(s.dbPath("正常项目"));

  await api.createProject("test");
  assert.equal((await api.getProjectDatabaseSummary("test")).total, 0);
  await api.withProjectDatabase("test", (db) => {
    db.prepare("INSERT INTO device_point (project_name, point_code, point_name, calibration_id, cruise_id) VALUES (?, ?, ?, ?, 0)")
      .run("test", "共享编码", "新项目自己的点位", "700001");
  });
  await api.closeAllProjectDatabases();
  const second = runIsolatedStartup(s, "test");
  assert.equal(second.ipcReady, true);
  assert.deepEqual(second.points, [{ id: 1, projectName: "test", pointCode: "共享编码", pointName: "新项目自己的点位", calibrationId: "700001" }]);
  assert.deepEqual(fs.readFileSync(s.options.legacyDatabasePath), original);
  fs.writeFileSync(s.options.legacyDatabasePath, "模拟旧备份此后已损坏");
  const third = runIsolatedStartup(s, "test");
  assert.deepEqual(third, second);
  assert.deepEqual(fs.readFileSync(s.options.journalPath), completedJournal);
  assert.deepEqual(fs.readFileSync(s.dbPath("正常项目")), normalDatabase);
  assert.equal(fs.existsSync(path.join(s.root, "智洋培训")), false);
});

test("真实发布失败模拟：第二个项目写盘后发布中断，独立进程续传且不重写第一个项目", async (t) => {
  const s = setup(t);
  const original = await seed(s);
  const rename = fs.renameSync;
  let interrupted = false;
  fs.renameSync = (source, target) => {
    if (!interrupted && path.resolve(String(target)) === s.dbPath(s.names[1])) {
      interrupted = true;
      throw new Error("模拟第二个项目发布时中断");
    }
    return rename(source, target);
  };
  try { await assert.rejects(s.run(), /模拟第二个项目发布时中断/); }
  finally { fs.renameSync = rename; }
  assert.equal(interrupted, true);
  const journal = JSON.parse(fs.readFileSync(s.options.journalPath));
  assert.equal(journal.phase, "splitting");
  assert.equal(journal.projects.find((record) => record.projectName === s.names[0]).status, "complete");
  assert.equal(journal.projects.find((record) => record.projectName === s.names[1]).status, "copying");
  assert.equal(fs.existsSync(s.dbPath(s.names[1])), false);
  const stagePath = s.dbPath(s.names[1]) + "." + journal.batchId + ".tmp";
  assert.equal(fs.existsSync(stagePath), true);
  const firstDatabase = fs.readFileSync(s.dbPath(s.names[0]));
  const resumed = runIsolatedStartup(s, s.names[1]);
  assert.equal(resumed.ipcReady, true);
  assert.equal(resumed.points.length, 1);
  assert.equal(resumed.points[0].id, 110);
  assert.equal(resumed.points[0].calibrationId, "117");
  assert.equal(JSON.parse(fs.readFileSync(s.options.journalPath)).phase, "complete");
  assert.equal(fs.existsSync(stagePath), false);
  assert.deepEqual(fs.readFileSync(s.dbPath(s.names[0])), firstDatabase);
  assert.deepEqual(fs.readFileSync(s.options.legacyDatabasePath), original);
});

test("切项目拒绝旧会话与项目不匹配请求；数据库操作与目录迁移互斥", async (t) => {
  const s = setup(t);
  await seed(s);
  await api.initDbIpc(s.options);
  const sessionA = await api.openProjectDatabase(s.names[0]);
  const sessionB = await api.openProjectDatabase(s.names[1]);
  const list = handlers.get("db:point:list");
  assert.equal((await list({}, sessionA, s.names[0])).ok, false);
  assert.equal((await list({}, sessionB, s.names[0])).ok, false);
  const result = await list({}, sessionB, s.names[1]);
  assert.equal(result.ok, true);
  assert.equal(result.data[0].projectName, s.names[1]);
  const release = api.beginProjectDirectoryMigration();
  try { await assert.rejects(list({}, sessionB, s.names[1]), /保存目录正在迁移/); }
  finally { release(); }
  assert.throws(() => api.getDatabase(), /Open a project database first/);
  const exportData = await api.prepareNormalAnnotationExport(s.names[0], [{ pointCode: "共享编码", origin: [1, 2, 3], direction: [0, 1, 0], diameter: 2 }]);
  assert.equal(exportData.rows[0].pointName, "测试点位");
});

test("项目目录迁移前关闭延迟保存；切根后新会话重开，不重建旧路径", async (t) => {
  const s = setup(t, ["中文 项目甲"]);
  await seed(s);
  await s.run();
  const session = await api.openProjectDatabase(s.names[0]);
  await api.withProjectDatabaseSession(session.projectName, session.sessionVersion, (db) => {
    db.prepare("UPDATE device_point SET point_name = '迁移前修改'").run();
  });
  const target = path.join(s.base, "新保存目录");
  await api.migrateDataPath(target);
  s.options.projectRoot = target;
  await s.run();
  await assert.rejects(api.withProjectDatabaseSession(session.projectName, session.sessionVersion, () => {}), /会话已切换/);
  const opened = await api.openProjectDatabase(s.names[0]);
  await api.withProjectDatabaseSession(opened.projectName, opened.sessionVersion, (db) => {
    assert.equal(db.prepare("SELECT point_name FROM device_point").get().pointName, "迁移前修改");
    assert.ok(db.getFilePath().startsWith(target + path.sep));
  });
  assert.equal(fs.existsSync(s.dbPath(s.names[0])), false);
});

test("目录迁移关闭所有项目、全局和未托管数据库连接", async (t) => {
  const s = setup(t, ["中文 项目甲"]);
  await seed(s);
  await s.run();
  const session = await api.openProjectDatabase(s.names[0]);
  const loosePath = path.join(s.base, "未托管数据库.db");
  const looseDatabase = await api.openDatabaseAtPath(loosePath);
  looseDatabase.exec("CREATE TABLE shutdown_probe (value INTEGER); INSERT INTO shutdown_probe VALUES (42)");
  const globalPath = path.join(s.base, "全局数据库", "robot-config.db");
  const globalDatabase = await api.initDatabase(path.dirname(globalPath), path.basename(globalPath));
  globalDatabase.exec("CREATE TABLE shutdown_probe (value INTEGER); INSERT INTO shutdown_probe VALUES (24)");

  await api.closeAllProjectDatabases();

  assert.equal(looseDatabase.isClosed(), true);
  assert.equal(globalDatabase.isClosed(), true);
  assert.equal(api.getActiveProjectDatabaseSession(), null);
  assert.throws(() => api.getDatabase(), /Open a project database first/);
  const looseVerification = await api.openDatabaseAtPath(loosePath, false, false);
  const globalVerification = await api.openDatabaseAtPath(globalPath, false, false);
  try {
    assert.equal(looseVerification.prepare("SELECT value FROM shutdown_probe").get().value, 42);
    assert.equal(globalVerification.prepare("SELECT value FROM shutdown_probe").get().value, 24);
  } finally {
    looseVerification.discardAndClose();
    globalVerification.discardAndClose();
  }

  const reopened = await api.openProjectDatabase(s.names[0]);
  assert.notEqual(reopened.sessionVersion, session.sessionVersion);
  const points = await api.withProjectDatabaseSession(reopened.projectName, reopened.sessionVersion,
    (db) => db.prepare("SELECT point_name FROM device_point").all());
  assert.equal(points[0].pointName, "测试点位");
});

test("未完成批次拒绝变化的源库；残留临时库重建，不依赖半写入文件", async (t) => {
  const s = setup(t);
  await seed(s);
  await s.run();
  const journal = JSON.parse(fs.readFileSync(s.options.journalPath));
  journal.phase = "splitting";
  journal.projects[1].status = "copying";
  fs.writeFileSync(s.options.journalPath, JSON.stringify(journal));
  fs.rmSync(s.dbPath(s.names[1]));
  const stage = s.dbPath(s.names[1]) + "." + journal.batchId + ".tmp";
  fs.writeFileSync(stage, "半写入数据");
  await s.run();
  assert.equal(fs.existsSync(stage), false);
  journal.projects[0].status = "pending";
  fs.writeFileSync(s.options.journalPath, JSON.stringify(journal));
  const db = await api.openDatabaseAtPath(s.options.legacyDatabasePath);
  db.prepare("UPDATE device_point SET point_name = '旧版后续编辑'").run();
  db.close();
  await assert.rejects(s.run(), /旧总库发生变化/);
});

test("完成批次的清单被旧版改写时，从身份匹配的项目库补回元数据，保留后续编辑", async (t) => {
  const s = setup(t);
  await seed(s);
  await s.run();
  const file = s.dbPath(s.names[0]);
  const db = await api.openDatabaseAtPath(file, false);
  db.prepare("UPDATE device_point SET point_name = '拆分后的编辑'").run();
  db.close();
  const bytes = fs.readFileSync(file);
  const manifestFile = path.join(s.root, s.names[0], "project.manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile));
  delete manifest.database;
  manifest.schemaVersion = 1;
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  fs.rmSync(s.options.legacyDatabasePath);
  await s.run();
  const repaired = JSON.parse(fs.readFileSync(manifestFile));
  assert.equal(repaired.database.path, "database/robot-config.db");
  assert.equal(repaired.project.id, manifest.project.id);
  assert.deepEqual(fs.readFileSync(file), bytes);
  await api.openProjectDatabase(s.names[0]);
  const mismatch = JSON.parse(fs.readFileSync(manifestFile));
  delete mismatch.database;
  mismatch.project.id = "wrong-project-id";
  fs.writeFileSync(manifestFile, JSON.stringify(mismatch));
  await assert.rejects(s.run(), /归属校验失败/);
  assert.deepEqual(fs.readFileSync(file), bytes);
});

test("缺失源库的旧项目、损坏的项目库和越界清单均报恢复错误；新项目明确空建", async (t) => {
  const missing = setup(t, ["未迁移项目"]);
  await assert.rejects(missing.run(), /旧总库不存在/);
  assert.equal(fs.existsSync(missing.dbPath(missing.names[0])), false);
  const s = setup(t, []);
  await s.run();
  await api.createProject("新项目");
  await s.run();
  const dbFile = s.dbPath("新项目");
  const bytes = fs.readFileSync(dbFile);
  await assert.rejects(api.writeProjectFile("新项目", "database/robot-config.db", new ArrayBuffer(0)), /禁止直接修改/);
  await assert.rejects(api.deleteProjectPath(path.dirname(dbFile)), /禁止直接修改/);
  await assert.rejects(api.renameProjectPath(path.dirname(dbFile), "other"), /禁止直接修改/);
  assert.deepEqual(fs.readFileSync(dbFile), bytes);
  const manifestFile = path.join(s.root, "新项目", "project.manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile));
  manifest.database.path = "../../outside.db";
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  await assert.rejects(s.run(), /路径越出项目目录/);
  manifest.database.path = "database/robot-config.db";
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  fs.writeFileSync(dbFile, "损坏内容");
  await assert.rejects(s.run());
  assert.equal(fs.readFileSync(dbFile, "utf8"), "损坏内容");
});

test("preload 切库立即禁用旧会话，迟到的打开/关闭结果不会覆盖新会话", async () => {
  let exposed;
  const pending = [];
  const requests = [];
  const electron = {
    contextBridge: { exposeInMainWorld: (_name, value) => { exposed = value; } }, webUtils: {},
    ipcRenderer: { invoke: (channel, ...args) => {
      if (channel.startsWith("project:")) return new Promise((resolve) => pending.push({ channel, resolve }));
      requests.push({ channel, args });
      return Promise.resolve({ ok: true, data: [] });
    } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(appDir, "electron/preload.cjs"), "utf8"), { require: () => electron, process });
  const openingA = exposed.project.openDatabase("A");
  const openingB = exposed.project.openDatabase("B");
  pending[1].resolve({ projectName: "B", sessionVersion: 2 });
  await openingB;
  pending[0].resolve({ projectName: "A", sessionVersion: 1 });
  await openingA;
  await exposed.db.point.list("B");
  assert.equal(requests.at(-1).args[0].projectName, "B");
  const closing = exposed.project.closeDatabase();
  await assert.rejects(exposed.db.point.list("B"), /请先打开项目数据库/);
  const openingC = exposed.project.openDatabase("C");
  pending[3].resolve({ projectName: "C", sessionVersion: 3 });
  await openingC;
  pending[2].resolve();
  await closing;
  await exposed.db.point.list("C");
  assert.equal(requests.at(-1).args[0].projectName, "C");
});
