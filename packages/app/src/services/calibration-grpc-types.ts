// Matches qb_cbr_grpc.ExternalInteraction.ei_camera_calibration_delivery.
export interface CameraCalibrationDeliveryRequest {
  SendCode: string;
  ReceiveCode: string;
  Time: string;
  camera_id: string;
  type: 0 | 1;
}

export interface CameraCalibrationDeliveryReply {
  SendCode: string;
  ReceiveCode: string;
  Time: string;
  Code: string;
  Message: string;
}

export interface CalibrationGrpcStatus {
  connected: boolean;
  robotCode: string | null;
  changedAt: string | null;
}

export interface CalibrationGrpcEndpoint {
  host: string;
  port: number;
}
