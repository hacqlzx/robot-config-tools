import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import type {
  CalibrationGrpcEndpoint,
  CalibrationGrpcStatus,
  CameraCalibrationDeliveryReply,
  CameraCalibrationDeliveryRequest,
} from "../../src/services/calibration-grpc-types";
import type { CalibrationGrpcTransport } from "../ipc/calibration-grpc-transport";

interface CalibrationClient extends grpc.Client {
  ei_camera_calibration_delivery(
    request: CameraCalibrationDeliveryRequest,
    options: grpc.CallOptions,
    callback: (error: grpc.ServiceError | null, reply: CameraCalibrationDeliveryReply) => void,
  ): grpc.ClientUnaryCall;
}

interface CalibrationClientConstructor {
  new(address: string, credentials: grpc.ChannelCredentials): CalibrationClient;
}

interface ExternalInteractionDefinition {
  qb_cbr_grpc?: {
    ExternalInteraction?: CalibrationClientConstructor;
  };
}

interface ActiveSession {
  robotCode: string;
  changedAt: string;
  client: CalibrationClient;
}

export interface NodeCalibrationGrpcOptions {
  readyTimeoutMs?: number;
  callTimeoutMs?: number;
  credentials?: grpc.ChannelCredentials;
}

const disconnected = (): CalibrationGrpcStatus => ({ connected: false, robotCode: null, changedAt: null });

function assertConnection(robotCode: string, endpoint: CalibrationGrpcEndpoint): void {
  if (typeof robotCode !== "string" || !robotCode.trim() || robotCode.length > 128) {
    throw new Error("机器人编码无效");
  }
  if (typeof endpoint?.host !== "string" || !endpoint.host.trim()
    || !Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) {
    throw new Error("机器人连接地址无效");
  }
}

function assertRequest(request: CameraCalibrationDeliveryRequest): void {
  if (!request || typeof request.SendCode !== "string" || !request.SendCode.trim()
    || typeof request.ReceiveCode !== "string" || !request.ReceiveCode.trim()
    || typeof request.Time !== "string" || !request.Time.trim()
    || typeof request.camera_id !== "string" || !request.camera_id.trim()
    || (request.type !== 0 && request.type !== 1)) {
    throw new Error("标定请求参数无效");
  }
}

export class NodeCalibrationGrpcTransport implements CalibrationGrpcTransport {
  private readonly Client: CalibrationClientConstructor;
  private readonly readyTimeoutMs: number;
  private readonly callTimeoutMs: number;
  private readonly credentials: grpc.ChannelCredentials;
  private readonly sessions = new Map<number, ActiveSession>();

  constructor(protoPath: string, options: NodeCalibrationGrpcOptions = {}) {
    const packageDefinition = protoLoader.loadSync(protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const definition = grpc.loadPackageDefinition(packageDefinition) as unknown as ExternalInteractionDefinition;
    const Client = definition.qb_cbr_grpc?.ExternalInteraction;
    if (!Client) throw new Error("未找到相机标定服务定义");

    this.Client = Client;
    this.readyTimeoutMs = options.readyTimeoutMs ?? 5_000;
    this.callTimeoutMs = options.callTimeoutMs ?? 10_000;
    this.credentials = options.credentials ?? grpc.credentials.createInsecure();
  }

  status(senderId: number): CalibrationGrpcStatus {
    const session = this.sessions.get(senderId);
    return session
      ? { connected: true, robotCode: session.robotCode, changedAt: session.changedAt }
      : disconnected();
  }

  async connect(
    senderId: number,
    robotCode: string,
    endpoint: CalibrationGrpcEndpoint,
  ): Promise<CalibrationGrpcStatus> {
    assertConnection(robotCode, endpoint);
    await this.disconnect(senderId);

    const client = new this.Client(`${endpoint.host.trim()}:${endpoint.port}`, this.credentials);
    try {
      await new Promise<void>((resolve, reject) => {
        client.waitForReady(Date.now() + this.readyTimeoutMs, (error) => error ? reject(error) : resolve());
      });
    } catch (error) {
      client.close();
      throw new Error(`机器人连接失败：${error instanceof Error ? error.message : String(error)}`);
    }

    const session = { client, robotCode: robotCode.trim(), changedAt: new Date().toISOString() };
    this.sessions.set(senderId, session);
    return this.status(senderId);
  }

  disconnect(senderId: number, robotCode?: string): CalibrationGrpcStatus {
    const session = this.sessions.get(senderId);
    if (!session || (robotCode && session.robotCode !== robotCode)) return this.status(senderId);
    session.client.close();
    this.sessions.delete(senderId);
    return { ...disconnected(), changedAt: new Date().toISOString() };
  }

  remove(senderId: number): void {
    this.disconnect(senderId);
  }

  async deliver(
    senderId: number,
    request: CameraCalibrationDeliveryRequest,
  ): Promise<CameraCalibrationDeliveryReply> {
    assertRequest(request);
    const session = this.sessions.get(senderId);
    if (!session || session.robotCode !== request.ReceiveCode) {
      throw new Error("机器人连接未建立");
    }

    return new Promise((resolve, reject) => {
      session.client.ei_camera_calibration_delivery(
        request,
        { deadline: Date.now() + this.callTimeoutMs },
        (error, reply) => error ? reject(error) : resolve(reply),
      );
    });
  }
}
