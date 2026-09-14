import { app } from "electron";
import path from "node:path";

const PROTO_FILE = "external-interaction-calibration.proto";

export function getCalibrationGrpcProtoPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "grpc", "proto", PROTO_FILE)
    : path.join(app.getAppPath(), "electron", "grpc", "proto", PROTO_FILE);
}
