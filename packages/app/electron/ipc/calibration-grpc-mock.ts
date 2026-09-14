import type {
  CalibrationGrpcStatus,
  CameraCalibrationDeliveryReply,
  CameraCalibrationDeliveryRequest,
  CalibrationGrpcEndpoint,
} from "../../src/services/calibration-grpc-types";
import type { CalibrationGrpcTransport } from "./calibration-grpc-transport";

const disconnected = (): CalibrationGrpcStatus => ({ connected: false, robotCode: null, changedAt: null });

// Replace this class with the real gRPC client once endpoint and identity mapping are available.
export class MockCalibrationGrpc implements CalibrationGrpcTransport {
  private sessions = new Map<number, CalibrationGrpcStatus>();

  status(id: number): CalibrationGrpcStatus {
    return this.sessions.get(id) ?? disconnected();
  }

  connect(id: number, robotCode: string, endpoint: CalibrationGrpcEndpoint): CalibrationGrpcStatus {
    if (typeof robotCode !== "string" || !robotCode.trim() || robotCode.length > 128) {
      throw new Error("机器人编码无效");
    }
    if (typeof endpoint?.host !== "string" || !endpoint.host.trim()
      || !Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) {
      throw new Error("机器人连接地址无效");
    }
    const status = { connected: true, robotCode: robotCode.trim(), changedAt: new Date().toISOString() };
    this.sessions.set(id, status);
    return status;
  }

  disconnect(id: number, robotCode?: string): CalibrationGrpcStatus {
    if (robotCode && this.status(id).robotCode !== robotCode) return this.status(id);
    this.sessions.delete(id);
    return { ...disconnected(), changedAt: new Date().toISOString() };
  }

  remove(id: number): void {
    this.sessions.delete(id);
  }

  async deliver(id: number, request: CameraCalibrationDeliveryRequest): Promise<CameraCalibrationDeliveryReply> {
    if (!request || typeof request.SendCode !== "string" || !request.SendCode.trim()
      || typeof request.ReceiveCode !== "string" || !request.ReceiveCode.trim()
      || typeof request.Time !== "string" || !request.Time.trim()
      || typeof request.camera_id !== "string" || !request.camera_id.trim()
      || (request.type !== 0 && request.type !== 1)) {
      throw new Error("标定请求参数无效");
    }
    if (!this.status(id).connected || this.status(id).robotCode !== request.ReceiveCode) {
      throw new Error("机器人连接未建立");
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (!this.status(id).connected || this.status(id).robotCode !== request.ReceiveCode) {
      throw new Error("机器人连接已断开");
    }
    return {
      SendCode: request.ReceiveCode,
      ReceiveCode: request.SendCode,
      Time: new Date().toISOString(),
      Code: "0",
      Message: "指令已接收",
    };
  }
}
