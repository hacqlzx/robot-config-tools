import readline from "node:readline/promises";

const part = "(?:0|[1-9][0-9]*)";
const prereleasePart = `(?:${part}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const versionPattern = new RegExp(
  `^(${part})\\.(${part})\\.(${part})(?:-${prereleasePart}(?:\\.${prereleasePart})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$(?![\\s\\S])`,
);

export function validateVersion(version) {
  if (!versionPattern.test(version)) {
    throw new Error(`版本号格式无效：${version}。示例：1.0.4 或 1.1.0-beta.1`);
  }
  return version;
}

export function nextPatchVersion(version) {
  validateVersion(version);
  const [, major, minor, patch] = versionPattern.exec(version);
  return `${major}.${minor}.${BigInt(patch) + 1n}`;
}

export function parseVersionArguments(args) {
  let version;
  let automatic = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--auto") {
      automatic = true;
    } else if (argument === "--version" || argument.startsWith("--version=")) {
      if (version !== undefined) throw new Error("不能重复指定 --version");
      version = argument === "--version" ? args[++index] : argument.slice("--version=".length);
      if (!version) throw new Error("--version 后必须填写版本号");
      validateVersion(version);
    } else {
      throw new Error(`未知打包参数：${argument}。支持 --auto 或 --version 1.1.0`);
    }
  }
  if (automatic && version !== undefined) throw new Error("--auto 和 --version 不能同时使用");
  return { version, automatic };
}

export async function chooseVersion(currentVersion, options) {
  if (options.version !== undefined) return options.version;
  const defaultVersion = nextPatchVersion(currentVersion);
  if (options.automatic) return defaultVersion;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("当前终端无法交互，请使用 pnpm package --auto 或 pnpm package --version 1.1.0");
  }

  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = await input.question(
        `当前版本 ${currentVersion}，新版本 [${defaultVersion}]（回车使用默认值，q 取消）：`,
      );
      const version = answer.trim() || defaultVersion;
      if (version.toLowerCase() === "q") throw new Error("已取消打包，版本号未修改");
      try {
        return validateVersion(version);
      } catch (error) {
        console.error(error.message);
      }
    }
  } finally {
    input.close();
  }
}

export function replacePackageVersion(content, version) {
  validateVersion(version);
  const manifest = JSON.parse(content);
  // Match only the root version field, preserving indentation and line endings.
  const entries = [...content.matchAll(/^([ \t]*)"version"[ \t]*:[ \t]*"[^"]*"/gm)];
  const rootIndent = /\n([ \t]+)"(?:name|private)"\s*:/.exec(content)?.[1];
  const entry = entries.find((match) => match[1] === rootIndent);
  if (!entry || typeof manifest.version !== "string") throw new Error("无法定位顶层 version 字段");
  return content.slice(0, entry.index) + entry[0].replace(/"[^"]*"$/, `"${version}"`) +
    content.slice(entry.index + entry[0].length);
}
