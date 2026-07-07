export const MAP_DIR_NAME = "地图";
export const POINT_TABLE_DIR_NAME = "点表";

export const MODEL_FILE_ACCEPT = ".las,.laz";
export const POINT_TABLE_FILE_ACCEPT = ".xlsx,.xls";

export const MODEL_FILE_RE = /\.(las|laz)$/i;
export const LAS_FILE_RE = /\.las$/i;
export const POINT_TABLE_FILE_RE = /\.(xlsx|xls)$/i;

export function normalizeProjectPath(value: string): string {
  return value.replace(/\\/g, "/");
}

export function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

export function isLasOrLazFileName(fileName: string): boolean {
  return MODEL_FILE_RE.test(fileName);
}

export function isLasFileName(fileName: string): boolean {
  return LAS_FILE_RE.test(fileName);
}

export function stripModelExtension(fileName: string): string {
  return fileName.replace(MODEL_FILE_RE, "");
}

export function siblingFilePath(filePath: string, nextFileName: string): string {
  return filePath.replace(/[^\\/]+$/, nextFileName);
}

export function mapDirSubPath(mapName?: string): string {
  return mapName ? `${MAP_DIR_NAME}/${mapName}` : MAP_DIR_NAME;
}

export function mapModelFileSubPath(mapName: string, extension = ".las"): string {
  const normalizedExtension = extension.startsWith(".") ? extension : `.${extension}`;
  return `${mapDirSubPath(mapName)}/${mapName}${normalizedExtension}`;
}

export function pointTableFileSubPath(fileName: string): string {
  return `${POINT_TABLE_DIR_NAME}/${fileName}`;
}

export function projectSubPathFromDir(filePath: string, dirName: string, fallback: string): string {
  const normalized = normalizeProjectPath(filePath);
  const marker = `/${dirName}/`;
  const idx = normalized.indexOf(marker);
  return idx >= 0 ? normalized.slice(idx + 1) : fallback;
}

export function siblingProjectSubPath(filePath: string, dirName: string, nextFileName: string): string {
  const subPath = projectSubPathFromDir(filePath, dirName, nextFileName);
  return normalizeProjectPath(siblingFilePath(subPath, nextFileName));
}

export function mapSiblingFilePath(modelPath: string, fileName: string): string {
  return siblingFilePath(modelPath, fileName);
}

export function mapSiblingSubPath(modelPath: string, fileName: string): string {
  return siblingProjectSubPath(modelPath, MAP_DIR_NAME, fileName);
}
