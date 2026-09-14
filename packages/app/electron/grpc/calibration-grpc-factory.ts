import type { CalibrationGrpcTransport } from "../ipc/calibration-grpc-transport";
import { MockCalibrationGrpc } from "../ipc/calibration-grpc-mock";
import { NodeCalibrationGrpcTransport, type NodeCalibrationGrpcOptions } from "./node-calibration-grpc-transport";

type CalibrationGrpcFactoryOptions =
  | { mode: "mock" }
  | { mode: "grpc"; protoPath: string; clientOptions?: NodeCalibrationGrpcOptions };

export function createCalibrationGrpcTransport(
  options: CalibrationGrpcFactoryOptions,
): CalibrationGrpcTransport {
  if (options.mode === "grpc") {
    return new NodeCalibrationGrpcTransport(options.protoPath, options.clientOptions);
  }
  return new MockCalibrationGrpc();
}
