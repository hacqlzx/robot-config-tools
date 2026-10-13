import assert from "node:assert/strict";
import test from "node:test";
import { chooseVersion, nextPackageVersion, parseVersionArguments, replacePackageVersion, validateVersion } from "./package-version.mjs";

test("手动版本接受合法预发布和构建标记，拒绝格式错误", () => {
  for (const version of ["0.0.0", "1.1.0", "1.1.0-beta.1", "1.1.0+build.7"]) {
    assert.equal(validateVersion(version), version);
  }
  for (const version of ["1.0", "v1.0.4", "01.0.4", "1.0.4-01", "1.0.4-beta..1", "1.0.4\n", "1.0.4 & echo bad"]) {
    assert.throws(() => validateVersion(version));
  }
});

test("打包参数可指定版本或自动递增版本，错误参数在任何写入前拒绝", () => {
  assert.deepEqual(parseVersionArguments(["--version", "1.1.0"]), { version: "1.1.0", automatic: false });
  assert.deepEqual(parseVersionArguments(["--", "--version=1.1.0"]), { version: "1.1.0", automatic: false });
  assert.deepEqual(parseVersionArguments(["--auto"]), { version: undefined, automatic: true });
  for (const args of [["--version"], ["--version="], ["--version", "bad"], ["--auto", "--version=1.1.0"], ["--version=1.0.4", "--version=1.0.5"], ["--typo"]]) {
    assert.throws(() => parseVersionArguments(args));
  }
});

test("默认打包按补丁号序列递增，自动和手动模式可明确选择版本", async () => {
  assert.equal(nextPackageVersion("1.0.7"), "1.0.71");
  assert.equal(nextPackageVersion("1.0.71"), "1.0.72");
  assert.equal(nextPackageVersion("1.0.0"), "1.0.1");
  assert.equal(await chooseVersion("1.0.7", { automatic: true }), "1.0.71");
  assert.equal(await chooseVersion("1.0.7", { version: "1.0.8" }), "1.0.8");
  assert.equal(await chooseVersion("1.0.8", { automatic: true }), "1.0.81");
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    await assert.rejects(chooseVersion("1.0.7", {}), /无法交互/);
  }
});

test("仅更新根版本号，保留 CRLF、格式和嵌套版本字段", () => {
  for (const newline of ["\n", "\r\n"]) {
    const original = ['{', '  "name": "app",', '  "build": {', '    "version": "9.9.9"', '  },', '  "version": "1.0.3"', '}', ''].join(newline);
    assert.equal(replacePackageVersion(original, "1.1.0"), original.replace('"version": "1.0.3"', '"version": "1.1.0"'));
  }
});
