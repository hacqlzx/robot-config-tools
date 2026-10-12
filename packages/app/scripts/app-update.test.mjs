import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(new URL("../electron/app/update-controller.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { UpdateController } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

class FakeUpdater extends EventEmitter {
  checks = 0;
  downloads = 0;
  installs = 0;
  async checkForUpdates() {
    this.checks += 1;
    this.emit("checking-for-update");
    this.emit("update-available", { version: "1.0.6" });
    return {};
  }
  async downloadUpdate() {
    this.downloads += 1;
    this.emit("download-progress", { percent: 50 });
    this.emit("update-downloaded", { version: "1.0.6" });
    return [];
  }
  quitAndInstall() { this.installs += 1; }
}

test("启动检查只标记新版本，不自动下载或退出安装", async () => {
  const updater = new FakeUpdater();
  const controller = new UpdateController(updater, "1.0.5", true, () => {});
  await controller.check();
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(controller.snapshot().phase, "available");
  assert.equal(controller.snapshot().latestVersion, "1.0.6");
  assert.equal(updater.downloads, 0);
  assert.equal(updater.installs, 0);
});

test("未下载不能安装，下载后需显式安装且重复请求不重复退出", async () => {
  const updater = new FakeUpdater();
  const states = [];
  const controller = new UpdateController(updater, "1.0.5", true, (state) => states.push(state.phase));
  assert.equal(controller.install().success, false);
  assert.equal((await controller.download()).success, false);
  await controller.check();
  await controller.download();
  assert.equal(controller.snapshot().phase, "downloaded");
  assert.equal(updater.installs, 0);
  controller.install();
  controller.install();
  await new Promise(setImmediate);
  assert.equal(updater.installs, 1);
  assert.ok(states.includes("downloading"));
  assert.ok(states.includes("installing"));
});

test("开发模式不发检查、下载或安装请求", async () => {
  const updater = new FakeUpdater();
  const controller = new UpdateController(updater, "1.0.5", false, () => {});
  assert.equal((await controller.check()).success, false);
  assert.equal((await controller.download()).success, false);
  assert.equal(controller.install().success, false);
  assert.equal(updater.checks, 0);
  assert.equal(controller.snapshot().phase, "disabled");
});

test("网络失败后可以重试，下载失败保留新版本供重试", async () => {
  const updater = new FakeUpdater();
  const controller = new UpdateController(updater, "1.0.5", true, () => {});
  const normalCheck = updater.checkForUpdates.bind(updater);
  updater.checkForUpdates = async () => { throw new Error("ENOTFOUND"); };
  assert.equal((await controller.check()).success, false);
  assert.match(controller.snapshot().message, /网络/);
  updater.checkForUpdates = normalCheck;
  await controller.check();
  const normalDownload = updater.downloadUpdate.bind(updater);
  updater.downloadUpdate = async () => { throw new Error("ETIMEDOUT"); };
  assert.equal((await controller.download()).success, false);
  assert.equal(controller.snapshot().latestVersion, "1.0.6");
  updater.downloadUpdate = normalDownload;
  assert.equal((await controller.download()).success, true);
});

test("并发检查合并，下载完成后检查不覆盖待安装状态", async () => {
  const updater = new FakeUpdater();
  let resolve;
  updater.checkForUpdates = () => { updater.checks += 1; return new Promise((done) => { resolve = done; }); };
  const controller = new UpdateController(updater, "1.0.5", true, () => {});
  const pending = controller.check();
  await controller.check();
  assert.equal(updater.checks, 1);
  updater.emit("update-available", { version: "1.0.6" });
  resolve({});
  await pending;
  await controller.download();
  await controller.check();
  assert.equal(updater.checks, 1);
  assert.equal(controller.snapshot().phase, "downloaded");
});

test("没有新版本时清除新版本标记", async () => {
  const updater = new FakeUpdater();
  const controller = new UpdateController(updater, "1.0.5", true, () => {});
  updater.checkForUpdates = async () => { updater.emit("update-not-available", { version: "1.0.5" }); return {}; };
  await controller.check();
  assert.equal(controller.snapshot().phase, "latest");
  assert.equal(controller.snapshot().latestVersion, undefined);
});
