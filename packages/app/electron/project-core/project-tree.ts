import fs from "fs";
import path from "path";

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
}

export function readDirTree(dirPath: string): TreeNode[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true }).filter((entry) => {
    if (!entry.isDirectory()) return true;
    const lowerName = entry.name.toLowerCase();
    return lowerName !== ".potree" && !lowerName.startsWith(".potree.");
  }).map((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      return { name: entry.name, path: fullPath, isDir: true, children: readDirTree(fullPath) };
    }
    return { name: entry.name, path: fullPath, isDir: false };
  });
}
