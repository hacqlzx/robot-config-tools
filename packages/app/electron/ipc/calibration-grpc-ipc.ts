import { ipcMain } from "electron";
import type { CalibrationGrpcEndpoint, CameraCalibrationDeliveryRequest } from "../../src/services/calibration-grpc-types";
import { createCalibrationGrpcTransport } from "../grpc/calibration-grpc-factory";
import { getCalibrationGrpcProtoPath } from "../grpc/calibration-grpc-proto-path";
import type { CalibrationGrpcTransport } from "./calibration-grpc-transport";

// Each renderer owns its session. The renderer only sees this narrow IPC contract.
// Keep the production adapter opt-in until the robot endpoint is ready for integration.
const transport: CalibrationGrpcTransport = process.env.CALIBRATION_GRPC_ENABLED === "true"
  ? createCalibrationGrpcTransport({ mode: "grpc", protoPath: getCalibrationGrpcProtoPath() })
  : createCalibrationGrpcTransport({ mode: "mock" });
const registeredSenders = new Set<number>();

export function registerCalibrationGrpcIpc(): void {
  ipcMain.handle("calibration-grpc:status", (event) => transport.status(event.sender.id));

  ipcMain.handle("calibration-grpc:connect", async (event, robotCode: string, endpoint: CalibrationGrpcEndpoint) => {
    const id = event.sender.id;
    if (!registeredSenders.has(id)) {
      registeredSenders.add(id);
      event.sender.once("destroyed", () => {
        void transport.remove(id);
        registeredSenders.delete(id);
      });
    }
    const status = await transport.connect(id, robotCode, endpoint);
    event.sender.send("calibration-grpc:changed", status);
    return status;
  });

  ipcMain.handle("calibration-grpc:disconnect", async (event, robotCode?: string) => {
    const id = event.sender.id;
    const status = await transport.disconnect(id, robotCode);
    event.sender.send("calibration-grpc:changed", status);
    return status;
  });

  ipcMain.handle("calibration-grpc:deliver", (event, request: CameraCalibrationDeliveryRequest) =>
    transport.deliver(event.sender.id, request));
}
