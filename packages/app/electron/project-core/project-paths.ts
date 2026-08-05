import path from "path";
import { ensureProjectRoot, getProjectRoot } from "./project-root";

/**
 * 校验用户输入的单级路径片段，例如项目名、地图名。
 * 禁止路径分隔符和 Windows 非法文件名字符，避免目录穿越。
 */
export function assertSafePathSegment(name: string, label: string): string {
  const value = String(name ?? "").trim();
  if (!value) throw new Error(`${label}不能为空`);
  if (value === "." || value === ".." || /[<>:"/\\|?*\x00-\x1F]/.test(value)) {
    throw new Error(`${label}包含非法字符`);
  }
  return value;
}

/**
 * 判断 target 是否位于 parent 内部。
 */
export function isPathInside(parent: string, target: string): boolean {
  const parentResolved = path.resolve(parent);
  const targetResolved = path.resolve(target);
  const relative = path.relative(parentResolved, targetResolved);
  return relative === "" || (!!relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/**
 * 路径越界保护。所有项目文件读写前都应通过这里校验最终绝对路径。
 */
export function assertInside(parent: string, target: string, action: string): string {
  const resolved = path.resolve(target);
  if (!isPathInside(parent, resolved)) {
    throw new Error(`路径越界，禁止${action}`);
  }
  return resolved;
}

/**
 * 解析项目目录：{PROJECT_ROOT}/{projectName}。
 */
export function resolveProjectDir(projectName: string): string {
  ensureProjectRoot();
  const projectRoot = getProjectRoot();
  const safeProjectName = assertSafePathSegment(projectName, "项目名称");
  const dirPath = path.resolve(projectRoot, safeProjectName);
  return assertInside(projectRoot, dirPath, "访问项目");
}

/**
 * 解析项目内文件路径，并限制结果不能越过当前项目目录。
 */
export function resolveProjectPath(projectName: string, ...segments: string[]): string {
  const projectDir = resolveProjectDir(projectName);
  const targetPath = path.resolve(projectDir, ...segments);
  return assertInside(projectDir, targetPath, "访问项目文件");
}

/**
 * 解析已知绝对路径到项目根目录内，用于删除/重命名等 IPC 参数校验。
 */
export function resolveProjectRootPath(targetPath: string, action: string): string {
  ensureProjectRoot();
  const value = String(targetPath ?? "").trim();
  if (!value) throw new Error("路径不能为空");
  if (!path.isAbsolute(value)) {
    throw new Error(`路径必须是绝对路径，禁止${action}`);
  }
  const resolved = path.resolve(value);
  return assertInside(getProjectRoot(), resolved, action);
}

/**
 * 把项目内绝对路径转换成 manifest 使用的 POSIX 风格相对路径。
 */
export function toProjectRelativePath(projectDir: string, targetPath: string): string {
  const relative = path.relative(projectDir, assertInside(projectDir, targetPath, "访问项目文件"));
  return relative.replace(/\\/g, "/");
}

export function getProjectContextFromPath(targetPath: string): { projectName: string; projectDir: string } {
  const relative = path.relative(path.resolve(getProjectRoot()), targetPath);
  const [projectName] = relative.split(path.sep);
  if (!projectName) throw new Error("无法识别项目路径");
  return { projectName, projectDir: resolveProjectDir(projectName) };
}
