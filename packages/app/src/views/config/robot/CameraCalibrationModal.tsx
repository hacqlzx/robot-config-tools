import { useEffect, useMemo, useState } from "react";
import { Alert, App, Empty, Modal, Segmented, Tooltip } from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { cameraCalibrationDelivery } from "@/api/config.js";
import { getRequestErrorMessage } from "@/services/http";
import type { CameraVO } from "./CameraTableModal";
import "./CameraCalibrationModal.scss";

type CalibrationType = 0 | 1;

interface ApiResponse {
  code: number;
  message: string | null;
  success: boolean;
}

interface Props {
  open: boolean;
  data: CameraVO[];
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
}

const CALIBRATION_OPTIONS = [
  { label: "内参标定", value: 0 },
  { label: "外参标定", value: 1 },
];

function getCameraIp(camera: CameraVO): string {
  if (camera.videoType === "2") return camera.infraredIp || "-";
  return camera.visibleIp || camera.infraredIp || "-";
}

function CalibrationStatus({ label, state }: { label: string; state?: number }) {
  const success = state === 1;
  const text = success ? "标定成功" : state === 2 ? "标定失败" : "未标定";
  return (
    <Tooltip title={text}>
      <span className={`camera-calibration-status ${success ? "is-success" : "is-pending"}`}>
        {label}
        {success ? <CheckOutlined /> : <CloseOutlined />}
      </span>
    </Tooltip>
  );
}

export default function CameraCalibrationModal({ open, data, onClose, onSuccess }: Props) {
  const { message, modal } = App.useApp();
  const [selectedCameraId, setSelectedCameraId] = useState<number | null>(null);
  const [calibrationType, setCalibrationType] = useState<CalibrationType>(0);
  const [submitting, setSubmitting] = useState(false);

  const selectedCamera = useMemo(
    () => data.find((item) => item.cameraId === selectedCameraId) ?? null,
    [data, selectedCameraId],
  );

  useEffect(() => {
    if (!open) {
      setCalibrationType(0);
      return;
    }
    setSelectedCameraId((current) => (
      data.some((item) => item.cameraId === current) ? current : data[0]?.cameraId ?? null
    ));
  }, [data, open]);

  const deliverCalibration = async () => {
    if (!selectedCamera) return;
    const label = calibrationType === 0 ? "内参" : "外参";
    setSubmitting(true);
    try {
      const response = await cameraCalibrationDelivery(selectedCamera.cameraId, calibrationType);
      const body = response.data as ApiResponse;
      if (!body.success) {
        message.error(body.message || `${label}标定指令下发失败`);
        return;
      }
      message.success(`${label}标定指令已下发`);
      await onSuccess();
      onClose();
    } catch (error) {
      message.error(getRequestErrorMessage(error, `${label}标定指令下发失败`));
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = () => {
    if (!selectedCamera) return;
    const calibrated = calibrationType === 0
      ? selectedCamera.innerCalibrationState === 1
      : selectedCamera.outerCalibrationState === 1;
    if (!calibrated) {
      void deliverCalibration();
      return;
    }

    const label = calibrationType === 0 ? "内参" : "外参";
    modal.confirm({
      centered: true,
      title: `确认重新计算${label}？`,
      content: `该相机${label}已标定。重新计算后，已标定点位需重新下发勘察标定，是否继续？`,
      okText: "继续下发",
      cancelText: "取消",
      onOk: deliverCalibration,
    });
  };

  return (
    <Modal
      title="相机内外参计算"
      open={open}
      width={560}
      centered
      okText="确定"
      cancelText="取消"
      confirmLoading={submitting}
      okButtonProps={{ disabled: !selectedCamera }}
      maskClosable={!submitting}
      closable={!submitting}
      getContainer={false}
      onOk={handleConfirm}
      onCancel={onClose}
      destroyOnHidden
    >
      <div className="camera-calibration-modal">
        <div className="camera-calibration-label">选择相机</div>
        {data.length > 0 ? (
          <div className="camera-calibration-list" role="radiogroup" aria-label="选择相机">
            {data.map((camera) => {
              const selected = camera.cameraId === selectedCameraId;
              return (
                <button
                  key={camera.cameraId}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`camera-calibration-item${selected ? " is-selected" : ""}`}
                  onClick={() => setSelectedCameraId(camera.cameraId)}
                >
                  <span className="camera-calibration-icon"><VideoCameraOutlined /></span>
                  <span className="camera-calibration-info">
                    <span className="camera-calibration-name" title={camera.cameraName}>
                      {camera.cameraName || "未命名相机"}
                    </span>
                    <span className="camera-calibration-ip">{getCameraIp(camera)}</span>
                  </span>
                  <span className="camera-calibration-states">
                    <CalibrationStatus label="内参" state={camera.innerCalibrationState} />
                    <CalibrationStatus label="外参" state={camera.outerCalibrationState} />
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该机器人暂无相机" />
        )}

        <div className="camera-calibration-label camera-calibration-type-label">标定类型</div>
        <Segmented
          block
          options={CALIBRATION_OPTIONS}
          value={calibrationType}
          onChange={(value) => setCalibrationType(value as CalibrationType)}
        />
        <Alert
          type="info"
          showIcon
          message="内参和外参需分开拍摄，一次仅可下发一台相机的标定指令"
        />
      </div>
    </Modal>
  );
}
