import {
  createLasCoordinateTransform,
  loadLasCoordinateTransform as loadSharedLasCoordinateTransform,
  type LasCoordinateTransform,
  type Vec3Tuple,
} from "@/space-model/coordinate-transform";

type ElectronAPI = NonNullable<Window["electronAPI"]>;

export { createLasCoordinateTransform, type LasCoordinateTransform, type Vec3Tuple };

export async function loadLasCoordinateTransform(api: ElectronAPI, modelOrSiblingPath: string): Promise<LasCoordinateTransform> {
  return loadSharedLasCoordinateTransform({
    readChunk(filePath, offset, length) {
      return api.readFileChunk(filePath, offset, length);
    },
    readAll(filePath) {
      return api.readLargeFile(filePath);
    },
  }, modelOrSiblingPath);
}
