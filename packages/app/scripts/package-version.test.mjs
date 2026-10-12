import assert from "node:assert/strict";
import test from "node:test";
import { chooseVersion, nextPatchVersion, parseVersionArguments, replacePackageVersion, validateVersion } from "./package-version.mjs";

test("默认递增末位；预发布版本递增后回到正式版", () => {
  assert.equal(nextPatchVersion("1.0.3"), "1.0.4");
  assert.equal(nextPatchVersion("1.9.99"), "1.9.100");
  assert.equal(nextPatchVersion("2.0.3-beta.1+build.5"), "2.0.4");
});

test("手动版本接受合法预发布和构建标记，拒绝格式错误", () => {
  for (const version of ["0.0.0", "1.1.0", "1.1.0-beta.1", "1.1.0+build.7"]) {
    assert.equal(validateVersion(version), version);
  }
  for (const version of ["1.0", "v1.0.4", "01.0.4", "1.0.4-01", "1.0.4-beta..1", "1.0.4\n", "1.0.4 & echo bad"]) {
    assert.throws(() => validateVersion(version));
  }
});

test("打包参数可显式指定版本或递增，错误参数在任何写入前拒绝", () => {
  assert.deepEqual(parseVersionArguments(["--version", "1.1.0"]), { version: "1.1.0", automatic: false });
  assert.deepEqual(parseVersionArguments(["--", "--version=1.1.0"]), { version: "1.1.0", automatic: false });
  assert.deepEqual(parseVersionArguments(["--auto"]), { version: undefined, automatic: true });
  for (const args of [["--version"], ["--version="], ["--version", "bad"], ["--auto", "--version=1.1.0"], ["--version=1.0.4", "--version=1.0.5"], ["--typo"]]) {
    assert.throws(() => parseVersionArguments(args));
  }
});

test("非交互选择必须显式配置，不能因校验无终端而静默递增", async () => {
  assert.equal(await chooseVersion("1.0.3", { automatic: true }), "1.0.4");
  assert.equal(await chooseVersion("1.0.3", { version: "1.1.0" }), "1.1.0");
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    await assert.rejects(chooseVersion("1.0.3", {}), /无法交互/);
  }
});

test("仅更新根版本号，保留 CRLF、格式和嵌套版本字段", () => {
  for (const newline of ["\n", "\r\n"]) {
    const original = ['{', '  "name": "app",', '  "build": {', '    "version": "9.9.9"', '  },', '  "version": "1.0.3"', '}', ''].join(newline);
    assert.equal(replacePackageVersion(original, "1.1.0"), original.replace('"version": "1.0.3"', '"version": "1.1.0"'));
  }
});
