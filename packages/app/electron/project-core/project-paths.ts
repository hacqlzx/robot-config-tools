import path from "path";
import { ensureProjectRoot, getProjectRoot } from "./project-root";

export function assertSafePathSegment(name: string, label: string): string {
  const value = String(name ?? "").trim();
  if (!value) throw new Error(`${label}不能为空`);
  if (value === "." || value === ".." || /[<>:"/\\|?*\x00-\x1F]/.test(value)) {
    throw new Error(`${label}包含非法字符`);
  }
  return value;
}

export function isPathInside(parent: string, target: string): boolean {
  const parentResolved = path.resolve(parent);
  const targetResolved = path.resolve(target);
  const relative = path.relative(parentResolved, targetResolved);
  return relative === "" || (!!relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function assertInside(parent: string, target: string, action: string): string {
  const resolved = path.resolve(target);
  if (!isPathInside(parent, resolved)) {
    throw new Error(`路径越界，禁止${action}`);
  }
  return resolved;
}

export function resolveProjectDir(projectName: string): string {
  ensureProjectRoot();
  const projectRoot = getProjectRoot();
  const safeProjectName = assertSafePathSegment(projectName, "项目名称");
  const dirPath = path.resolve(projectRoot, safeProjectName);
  return assertInside(projectRoot, dirPath, "访问项目");
}

export function resolveProjectPath(projectName: string, ...segments: string[]): string {
  const projectDir = resolveProjectDir(projectName);
  const targetPath = path.resolve(projectDir, ...segments);
  return assertInside(projectDir, targetPath, "访问项目文件");
}

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
