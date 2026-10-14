import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

let migratorModuleId = 0;
async function loadMigrator(paths) {
  const key = `__legacyUserDataApp${++migratorModuleId}`;
  const sourcePath = new URL("../electron/app/legacy-user-data-migration.ts", import.meta.url);
  const source = fs.readFileSync(sourcePath, "utf8")
    .replace('import { app } from "electron";', `const app = globalThis.${key};`);
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  globalThis[key] = {
    getPath(name) {
      if (name === "appData") return paths.appData;
      if (name === "userData") return paths.userData;
      throw new Error(`unexpected app path: ${name}`);
    },
  };
  try {
    return await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
  } finally {
    delete globalThis[key];
  }
}

test("旧 userData 迁移复制持久化文件、跳过缓存并保持幂等", async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "robotconfig-userdata-test-"));
  const appData = path.join(base, "应用数据 中文");
  const legacy = path.join(appData, "app");
  const userData = path.join(appData, "RobotConfigTools");
  fs.mkdirSync(path.join(legacy, "database", "项目甲"), { recursive: true });
  fs.mkdirSync(path.join(legacy, "Cache"), { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(legacy, "database", "项目甲", "robot-config.db"), "旧数据库");
  fs.writeFileSync(path.join(legacy, "data-path.json"), '{"projectRoot":"D:/旧项目"}');
  fs.writeFileSync(path.join(legacy, "Cache", "缓存文件"), "可重建");
  fs.writeFileSync(path.join(userData, "data-path.json"), '{"projectRoot":"D:/新项目"}');

  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const { migrateLegacyUserData } = await loadMigrator({ appData, userData });
  await migrateLegacyUserData();

  assert.equal(fs.readFileSync(path.join(userData, "database", "项目甲", "robot-config.db"), "utf8"), "旧数据库");
  assert.equal(fs.readFileSync(path.join(userData, "data-path.json"), "utf8"), '{"projectRoot":"D:/新项目"}');
  assert.equal(fs.existsSync(path.join(userData, "Cache", "缓存文件")), false);
  const marker = path.join(userData, ".legacy-user-data-migration-v1.json");
  assert.equal(fs.existsSync(marker), true);

  fs.writeFileSync(path.join(legacy, "之后新增的文件"), "不应在已完成迁移后复制");
  await migrateLegacyUserData();
  assert.equal(fs.existsSync(path.join(userData, "之后新增的文件")), false);
});

test("旧 userData 迁移异常不阻止启动，且保留迁移源文件", async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "robotconfig-userdata-failure-test-"));
  const appData = path.join(base, "AppData");
  const legacy = path.join(appData, "app");
  const userData = path.join(appData, "RobotConfigTools");
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(legacy, "保留的旧数据源");
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  const { migrateLegacyUserDataForStartup } = await loadMigrator({ appData, userData });

  await assert.doesNotReject(migrateLegacyUserDataForStartup());
  assert.equal(fs.readFileSync(legacy, "utf8"), "保留的旧数据源");
});
