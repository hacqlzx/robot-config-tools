import { parseLasHeader, type LasHeader } from "@/playcanvas-core/io/read/las-reader";
import type { FileSource } from "./file-source";

const DEFAULT_MAP_MODEL_FILE_NAME = "map.las";

export type Vec3Tuple = [number, number, number];

export interface LasCoordinateTransform {
  header: LasHeader;
  modelPath: string;
  lasCenter: Vec3Tuple;
  lasToScene: (point: Vec3Tuple) => Vec3Tuple;
  sceneToLas: (point: Vec3Tuple) => Vec3Tuple;
}

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function isPointCloudFilePath(filePath: string): boolean {
  return /\.(las|laz)$/i.test(fileNameFromPath(filePath));
}

function siblingFilePath(filePath: string, nextFileName: string): string {
  return filePath.replace(/[^\\/]+$/, nextFileName);
}

export function resolvePointCloudModelPath(filePath: string, modelFileName = DEFAULT_MAP_MODEL_FILE_NAME): string {
  return isPointCloudFilePath(filePath) ? filePath : siblingFilePath(filePath, modelFileName);
}

export function createLasCoordinateTransform(header: LasHeader, modelPath: string): LasCoordinateTransform {
  const cx = (header.minX + header.maxX) / 2;
  const cy = (header.minY + header.maxY) / 2;
  const cz = (header.minZ + header.maxZ) / 2;

  return {
    header,
    modelPath,
    lasCenter: [cx, cy, cz],
    lasToScene: ([x, y, z]) => [x - cx, z - cz, -(y - cy)],
    sceneToLas: ([x, y, z]) => [x + cx, cy - z, y + cz],
  };
}

export async function loadLasCoordinateTransform(
  fileSource: FileSource,
  modelOrSiblingPath: string,
): Promise<LasCoordinateTransform> {
  const modelPath = resolvePointCloudModelPath(modelOrSiblingPath);
  const headerBuf = await fileSource.readChunk(modelPath, 0, 4096);
  return createLasCoordinateTransform(parseLasHeader(headerBuf), modelPath);
}
