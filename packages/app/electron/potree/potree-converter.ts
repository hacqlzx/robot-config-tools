import { app } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertInside, resolveProjectDir, resolveProjectRootPath } from "../project-core/project-paths";
import { ensureProjectRoot, getProjectRoot } from "../project-core/project-root";
import { createProjectAssetUrl } from "./project-asset-protocol";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POTREE_OUTPUT_DIR_NAME = ".potree";
const CONVERTER_ALIAS_DIR_NAME = ".potree-converter-runtime";
const REQUIRED_OUTPUT_FILES = ["metadata.json", "octree.bin", "hierarchy.bin"] as const;

export type PotreeConversionPhase = "checking" | "converting" | "validating" | "complete";

export interface PotreeConversionProgress {
  projectName: string;
  modelPath: string;
  phase: PotreeConversionPhase;
  percent: number;
  message: string;
}

export interface PotreeModelResult {
  modelPath: string;
  metadataUrl: string;
  generated: boolean;
}

type ProgressListener = (progress: PotreeConversionProgress) => void;

interface ActiveConversion {
  promise: Promise<PotreeModelResult>;
  listeners: Set<ProgressListener>;
}

const activeConversions = new Map<string, ActiveConversion>();

interface ConverterPathAlias {
  inputPath: string;
  outputPath: string;
  cleanup: () => Promise<void>;
}

function isAsciiPath(filePath: string): boolean {
  return /^[\x00-\x7F]*$/.test(filePath);
}

async function createConverterPathAlias(modelPath: string, outputDir: string): Promise<ConverterPathAlias> {
  if (isAsciiPath(modelPath) && isAsciiPath(outputDir)) {
    return { inputPath: modelPath, outputPath: outputDir, cleanup: async () => undefined };
  }

  ensureProjectRoot();
  const projectRoot = getProjectRoot();
  if (!isAsciiPath(projectRoot)) {
    throw new Error("PotreeConverter 2.1.3 不支持中文路径，请将项目数据根目录设置为纯英文路径");
  }

  const modelDir = path.dirname(modelPath);
  const outputRelativePath = path.relative(modelDir, outputDir);
  if (!outputRelativePath || outputRelativePath.startsWith("..") || path.isAbsolute(outputRelativePath)) {
    throw new Error("PotreeConverter 输出目录无效");
  }

  const aliasBase = path.join(projectRoot, CONVERTER_ALIAS_DIR_NAME);
  await fs.promises.mkdir(aliasBase, { recursive: true });
  const taskDir = await fs.promises.mkdtemp(path.join(aliasBase, "task-"));
  const modelDirAlias = path.join(taskDir, "model");
  let stagedInputDir: string | null = null;

  try {
    await fs.promises.symlink(modelDir, modelDirAlias, "junction");
    let inputRelativePath = path.basename(modelPath);

    if (!isAsciiPath(inputRelativePath)) {
      stagedInputDir = path.join(modelDir, `.potree.converter-source-${Date.now()}`);
      await fs.promises.mkdir(stagedInputDir, { recursive: true });
      const stagedInputPath = path.join(stagedInputDir, `input${path.extname(modelPath).toLowerCase() || ".las"}`);
      await fs.promises.link(modelPath, stagedInputPath);
      inputRelativePath = path.relative(modelDir, stagedInputPath);
    }

    const inputPath = path.join(modelDirAlias, inputRelativePath);
    const outputPath = path.join(modelDirAlias, outputRelativePath);
    if (!isAsciiPath(inputPath) || !isAsciiPath(outputPath)) {
      throw new Error("无法为 PotreeConverter 创建纯英文临时路径");
    }

    return {
      inputPath,
      outputPath,
      cleanup: async () => {
        await fs.promises.unlink(modelDirAlias).catch((_error: unknown): undefined => undefined);
        await fs.promises.rm(taskDir, { recursive: true, force: true }).catch((_error: unknown): undefined => undefined);
        if (stagedInputDir) {
          await fs.promises.rm(stagedInputDir, { recursive: true, force: true }).catch((_error: unknown): undefined => undefined);
        }
        await fs.promises.rmdir(aliasBase).catch((_error: unknown): undefined => undefined);
      },
    };
  } catch (error) {
    await fs.promises.unlink(modelDirAlias).catch((_cleanupError: unknown): undefined => undefined);
    await fs.promises.rm(taskDir, { recursive: true, force: true }).catch((_cleanupError: unknown): undefined => undefined);
    if (stagedInputDir) {
      await fs.promises.rm(stagedInputDir, { recursive: true, force: true }).catch((_cleanupError: unknown): undefined => undefined);
    }
    throw error;
  }
}

function resolveConverterPath(): string {
  const relative = path.join("PotreeConverter_2.1.3", "PotreeConverter.exe");
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, "potree", relative)]
    : [
        path.resolve(__dirname, "../src/potree-core", relative),
        path.resolve(process.cwd(), "src/potree-core", relative),
        path.resolve(process.cwd(), "packages/app/src/potree-core", relative),
      ];
  const converterPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!converterPath) throw new Error("未找到 PotreeConverter.exe，请检查应用资源是否完整");
  return converterPath;
}

async function hasUsableOutput(modelPath: string, outputDir: string): Promise<boolean> {
  try {
    const [sourceStat, ...outputStats] = await Promise.all([
      fs.promises.stat(modelPath),
      ...REQUIRED_OUTPUT_FILES.map((name) => fs.promises.stat(path.join(outputDir, name))),
    ]);
    return outputStats.every((stat) => stat.isFile() && stat.size > 0)
      && outputStats[0].mtimeMs >= sourceStat.mtimeMs;
  } catch {
    return false;
  }
}

async function validateOutput(outputDir: string): Promise<void> {
  const [metadataText, ...stats] = await Promise.all([
    fs.promises.readFile(path.join(outputDir, "metadata.json"), "utf-8"),
    fs.promises.stat(path.join(outputDir, "octree.bin")),
    fs.promises.stat(path.join(outputDir, "hierarchy.bin")),
  ]);
  JSON.parse(metadataText);
  if (stats.some((stat) => !stat.isFile() || stat.size <= 0)) {
    throw new Error("Converter 产物不完整");
  }
}

function createProgressParser(emit: (percent: number, message: string) => void) {
  let lastPercent = 4;
  let lastMessage = "正在读取模型信息";

  return (chunk: string) => {
    const lower = chunk.toLowerCase();
    let base = 5;
    let span = 85;
    let message = lastMessage;

    if (lower.includes("index")) {
      base = 8;
      span = 34;
      message = "正在建立点云索引";
    } else if (lower.includes("chunk") || lower.includes("sample")) {
      base = 42;
      span = 24;
      message = "正在构建层级数据";
    } else if (lower.includes("encod") || lower.includes("convert") || lower.includes("write")) {
      base = 66;
      span = 28;
      message = "正在写入 Potree 数据";
    }

    const overallMatch = /\[(\d+(?:\.\d+)?)\s*%,/.exec(chunk);
    const percentages = [...chunk.matchAll(/(\d+(?:\.\d+)?)\s*%/g)];
    const rawPercent = overallMatch
      ? Math.min(100, Math.max(0, Number(overallMatch[1])))
      : percentages.length > 0
        ? Math.min(100, Math.max(0, Number(percentages[percentages.length - 1][1])))
      : 0;
    const nextPercent = overallMatch
      ? Math.min(94, Math.round(rawPercent))
      : rawPercent > 0
        ? Math.min(94, Math.round(base + (rawPercent / 100) * span))
      : Math.min(92, lastPercent + (message !== lastMessage ? 2 : 0));

    if (nextPercent > lastPercent || message !== lastMessage) {
      lastPercent = Math.max(lastPercent, nextPercent);
      lastMessage = message;
      emit(lastPercent, lastMessage);
    }
  };
}

async function runConverter(
  modelPath: string,
  outputDir: string,
  onProgress: (percent: number, message: string) => void,
): Promise<void> {
  const converterPath = resolveConverterPath();
  await fs.promises.mkdir(path.dirname(outputDir), { recursive: true });
  await fs.promises.rm(outputDir, { recursive: true, force: true });
  const pathAlias = await createConverterPathAlias(modelPath, outputDir);

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(converterPath, [pathAlias.inputPath, "-o", pathAlias.outputPath], {
        cwd: path.dirname(converterPath),
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let logTail = "";
      const parseProgress = createProgressParser(onProgress);
      const consume = (data: Buffer | string) => {
        const text = data.toString();
        logTail = `${logTail}${text}`.slice(-16_000);
        parseProgress(text);
      };

      child.stdout.on("data", consume);
      child.stderr.on("data", consume);
      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        const detail = logTail.trim().split(/\r?\n/).slice(-8).join("\n");
        reject(new Error(`PotreeConverter 转换失败（退出码 ${code ?? "未知"}）${detail ? `\n${detail}` : ""}`));
      });
    });
  } finally {
    await pathAlias.cleanup();
  }
}

async function replaceOutputDirectory(tempDir: string, outputDir: string): Promise<void> {
  const backupDir = `${outputDir}.backup-${process.pid}-${Date.now()}`;
  const hasOldOutput = fs.existsSync(outputDir);
  if (hasOldOutput) await fs.promises.rename(outputDir, backupDir);

  try {
    await fs.promises.rename(tempDir, outputDir);
  } catch (error) {
    if (hasOldOutput && fs.existsSync(backupDir) && !fs.existsSync(outputDir)) {
      await fs.promises.rename(backupDir, outputDir);
    }
    throw error;
  }

  if (hasOldOutput) {
    void fs.promises.rm(backupDir, { recursive: true, force: true }).catch((error) => {
      console.warn("[potree-converter] failed to remove backup output", error);
    });
  }
}

async function ensureModelInternal(
  projectName: string,
  modelPath: string,
  notify: (phase: PotreeConversionPhase, percent: number, message: string) => void,
): Promise<PotreeModelResult> {
  notify("checking", 2, "正在检查 Potree 数据");
  const safeModelPath = assertInside(
    resolveProjectDir(projectName),
    resolveProjectRootPath(modelPath, "转换点云"),
    "转换点云",
  );
  if (!/\.(las|laz)$/i.test(safeModelPath)) throw new Error("仅支持转换 LAS/LAZ 模型");
  const sourceStat = await fs.promises.stat(safeModelPath);
  if (!sourceStat.isFile()) throw new Error("模型文件不存在");

  const outputDir = assertInside(path.dirname(safeModelPath), path.join(path.dirname(safeModelPath), POTREE_OUTPUT_DIR_NAME), "生成点云数据");
  const metadataPath = path.join(outputDir, "metadata.json");
  if (await hasUsableOutput(safeModelPath, outputDir)) {
    notify("complete", 100, "Potree 数据已就绪");
    return { modelPath: safeModelPath, metadataUrl: createProjectAssetUrl(metadataPath), generated: false };
  }

  const tempDir = `${outputDir}.tmp-${process.pid}-${Date.now()}`;
  try {
    notify("converting", 4, "正在启动 PotreeConverter");
    await runConverter(safeModelPath, tempDir, (percent, message) => notify("converting", percent, message));
    notify("validating", 96, "正在校验转换产物");
    await validateOutput(tempDir);
    await replaceOutputDirectory(tempDir, outputDir);
    notify("complete", 100, "Potree 数据已生成");
    return { modelPath: safeModelPath, metadataUrl: createProjectAssetUrl(metadataPath), generated: true };
  } catch (error) {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch((_cleanupError: unknown): undefined => undefined);
    throw error;
  }
}

export async function ensurePotreeModel(
  projectName: string,
  modelPath: string,
  onProgress: ProgressListener,
): Promise<PotreeModelResult> {
  const key = `${projectName}\0${path.resolve(modelPath).toLowerCase()}`;
  const existing = activeConversions.get(key);
  if (existing) {
    existing.listeners.add(onProgress);
    try {
      return await existing.promise;
    } finally {
      existing.listeners.delete(onProgress);
    }
  }

  const listeners = new Set<ProgressListener>([onProgress]);
  const notify = (phase: PotreeConversionPhase, percent: number, message: string) => {
    const progress = { projectName, modelPath, phase, percent, message };
    listeners.forEach((listener) => listener(progress));
  };
  const promise = ensureModelInternal(projectName, modelPath, notify);
  activeConversions.set(key, { promise, listeners });

  try {
    return await promise;
  } finally {
    activeConversions.delete(key);
  }
}
