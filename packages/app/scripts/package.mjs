import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chooseVersion, parseVersionArguments, replacePackageVersion } from "./package-version.mjs";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const packagePath = new URL("../package.json", import.meta.url);
const require = createRequire(import.meta.url);

function runNode(script, args = [], env = process.env) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: appRoot,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`打包步骤失败（${result.signal || result.status}）：${script}`);
}

async function main() {
  const options = parseVersionArguments(process.argv.slice(2));
  const original = fs.readFileSync(packagePath, "utf8");
  const currentVersion = JSON.parse(original).version;
  const version = await chooseVersion(currentVersion, options);
  const updated = replacePackageVersion(original, version);
  // Resolve tools before changing the manifest or running destructive preparation.
  const vite = path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js");
  const builder = require.resolve("electron-builder/cli.js");
  fs.writeFileSync(packagePath, updated, "utf8");
  console.log(`[package] 本次版本：${currentVersion} -> ${version}`);
  try {
    runNode(fileURLToPath(new URL("./prepare-package.mjs", import.meta.url)));
    runNode(vite, ["build"], { ...process.env, ELECTRON: "true" });
    runNode(builder, ["--win"]);
  } catch (error) {
    // Do not overwrite a concurrent manual edit.
    if (fs.readFileSync(packagePath, "utf8") === updated) {
      fs.writeFileSync(packagePath, original, "utf8");
      console.error(`[package] 打包失败，版本号已恢复为 ${currentVersion}`);
    }
    throw error;
  }
  console.log(`[package] 打包完成，应用版本已保存为 ${version}`);
}

main().catch((error) => {
  console.error(`[package] ${error.message}`);
  process.exitCode = 1;
});
