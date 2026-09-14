import type {
  CalibrationGrpcEndpoint,
  CalibrationGrpcStatus,
  CameraCalibrationDeliveryReply,
  CameraCalibrationDeliveryRequest,
} from "../../src/services/calibration-grpc-types";

type MaybePromise<T> = T | Promise<T>;

/**
 * Main-process transport boundary for camera calibration delivery.
 *
 * The production adapter should load ExternalInteraction.proto with
 * @grpc/proto-loader (`keepCase: true`), create an @grpc/grpc-js client in
 * connect(), call ei_camera_calibration_delivery() in deliver(), and call
 * client.close() in disconnect()/remove().
 */
export interface CalibrationGrpcTransport {
  status(senderId: number): MaybePromise<CalibrationGrpcStatus>;
  connect(
    senderId: number,
    robotCode: string,
    endpoint: CalibrationGrpcEndpoint,
  ): MaybePromise<CalibrationGrpcStatus>;
  disconnect(senderId: number, robotCode?: string): MaybePromise<CalibrationGrpcStatus>;
  remove(senderId: number): MaybePromise<void>;
  deliver(
    senderId: number,
    request: CameraCalibrationDeliveryRequest,
  ): Promise<CameraCalibrationDeliveryReply>;
}
