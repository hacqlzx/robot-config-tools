import { useEffect, useMemo, useState } from "react";
import { App, Button, Empty, Modal, Segmented, Tooltip } from "antd";
import { CheckOutlined, CloseOutlined, VideoCameraOutlined } from "@ant-design/icons";
import { getRequestErrorMessage } from "@/services/http";
import type { CameraCalibrationDeliveryRequest } from "@/services/calibration-grpc-types";
import type { CameraVO } from "./CameraTableModal";
import "./CameraCalibrationModal.scss";

type CalibrationType = 0 | 1;
type DeliveryResult = { cameraId: number; name: string; success: boolean; detail: string };

interface Props {
  open: boolean;
  data: CameraVO[];
  robotCode: string;
  robotIp: string;
  robotPort: number;
  onClose: () => void;
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
  const title = success ? "标定成功" : state === 2 ? "标定失败" : "未标定";
  return (
    <Tooltip title={title}>
      <span className={`camera-calibration-status ${success ? "is-success" : "is-pending"}`}>
        {label}{success ? <CheckOutlined /> : <CloseOutlined />}
      </span>
    </Tooltip>
  );
}

export default function CameraCalibrationModal({ open, data, robotCode, robotIp, robotPort, onClose }: Props) {
  const { message, modal } = App.useApp();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [calibrationType, setCalibrationType] = useState<CalibrationType>(0);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<DeliveryResult[]>([]);
  const deliveryClient = window.electronAPI?.calibrationGrpc;
  const selectedCameras = useMemo(() => data.filter((item) => selectedIds.includes(item.cameraId)), [data, selectedIds]);

  useEffect(() => {
    if (!open) {
      setCalibrationType(0);
      setSelectedIds([]);
      setResults([]);
      return;
    }
    setSelectedIds((current) => {
      const valid = current.filter((id) => data.some((item) => item.cameraId === id));
      return valid.length ? valid : data[0] ? [data[0].cameraId] : [];
    });
  }, [data, open]);

  const deliverCalibration = async () => {
    if (!deliveryClient || !selectedCameras.length || submitting) return;
    setSubmitting(true);
    setResults([]);
    const next: DeliveryResult[] = [];
    try {
      await deliveryClient.connect(robotCode, { host: robotIp.trim(), port: Number(robotPort) });
      for (const camera of selectedCameras) {
        const request: CameraCalibrationDeliveryRequest = {
          SendCode: "robot-config-tools",
          ReceiveCode: robotCode,
          Time: new Date().toISOString(),
          camera_id: String(camera.cameraId),
          type: calibrationType,
        };
        try {
          const reply = await deliveryClient.deliver(request);
          next.push({ cameraId: camera.cameraId, name: camera.cameraName || `相机 ${camera.cameraId}`,
            success: reply.Code === "0", detail: reply.Message || `返回码：${reply.Code}` });
        } catch (error) {
          next.push({ cameraId: camera.cameraId, name: camera.cameraName || `相机 ${camera.cameraId}`,
            success: false, detail: getRequestErrorMessage(error, "下发失败") });
        }
        setResults([...next]);
      }
    } catch (error) {
      const detail = getRequestErrorMessage(error, "机器人连接失败");
      setResults(selectedCameras.map((camera) => ({
        cameraId: camera.cameraId,
        name: camera.cameraName || `相机 ${camera.cameraId}`,
        success: false,
        detail,
      })));
    } finally {
      try {
        await deliveryClient.disconnect(robotCode);
      } catch {
        message.warning("本次下发结束后，机器人连接未正常关闭");
      }
      setSubmitting(false);
    }
  };

  const handleConfirm = () => {
    if (!deliveryClient) {
      message.error("当前运行环境不支持标定下发");
      return;
    }
    if (!robotCode.trim() || !robotIp.trim() || !Number.isInteger(Number(robotPort))
      || Number(robotPort) < 1 || Number(robotPort) > 65535) {
      message.error("机器人编码、IP 或端口无效，请先检查机器人配置");
      return;
    }
    if (!selectedCameras.length) return;
    const calibrated = selectedCameras.filter((camera) => calibrationType === 0
      ? camera.innerCalibrationState === 1 : camera.outerCalibrationState === 1);
    if (!calibrated.length) {
      void deliverCalibration();
      return;
    }
    const label = calibrationType === 0 ? "内参" : "外参";
    modal.confirm({
      centered: true,
      title: `确认重新计算${label}？`,
      content: `所选相机中 ${calibrated.length} 台${label}已标定。重新计算后，已标定点位需重新下发勘察标定，是否继续？`,
      okText: "继续下发",
      cancelText: "取消",
      onOk: deliverCalibration,
    });
  };

  const toggleCamera = (id: number) => {
    setResults([]);
    setSelectedIds((current) => calibrationType === 0 ? [id]
      : current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  return (
    <Modal
      title="相机内外参计算"
      open={open}
      width={580}
      centered
      okText={`下发${selectedCameras.length ? ` (${selectedCameras.length})` : ""}`}
      cancelText="关闭"
      confirmLoading={submitting}
      okButtonProps={{ disabled: !selectedCameras.length }}
      maskClosable={!submitting}
      closable={!submitting}
      getContainer={false}
      onOk={handleConfirm}
      onCancel={onClose}
      destroyOnHidden
    >
      <div className="camera-calibration-modal">
        <div className="camera-calibration-label camera-calibration-type-label">标定类型</div>
        <Segmented block options={CALIBRATION_OPTIONS} value={calibrationType} disabled={submitting}
          onChange={(value) => {
            setCalibrationType(value as CalibrationType);
            setResults([]);
            if (value === 0) setSelectedIds((current) => current.slice(0, 1));
          }} />
        <div className="camera-calibration-selection-header">
          <span className="camera-calibration-label">选择相机</span>
          {calibrationType === 1 && data.length > 1 && (
            <Button type="link" size="small" disabled={submitting} onClick={() => {
              setResults([]);
              setSelectedIds(selectedCameras.length === data.length ? [] : data.map((item) => item.cameraId));
            }}>{selectedCameras.length === data.length ? "清空" : "全选"}</Button>
          )}
        </div>
        {data.length > 0 ? (
          <div className="camera-calibration-list" role={calibrationType === 0 ? "radiogroup" : "group"} aria-label="选择相机">
            {data.map((camera) => {
              const selected = selectedIds.includes(camera.cameraId);
              return (
                <label key={camera.cameraId} className={`camera-calibration-item${selected ? " is-selected" : ""}`}>
                  <input type={calibrationType === 0 ? "radio" : "checkbox"}
                    name={calibrationType === 0 ? "calibration-camera" : undefined}
                    checked={selected} disabled={submitting} onChange={() => toggleCamera(camera.cameraId)} />
                  <span className="camera-calibration-icon"><VideoCameraOutlined /></span>
                  <span className="camera-calibration-info">
                    <span className="camera-calibration-name" title={camera.cameraName}>{camera.cameraName || "未命名相机"}</span>
                    <span className="camera-calibration-ip">{getCameraIp(camera)}</span>
                  </span>
                  <span className="camera-calibration-states">
                    <CalibrationStatus label="内参" state={camera.innerCalibrationState} />
                    <CalibrationStatus label="外参" state={camera.outerCalibrationState} />
                  </span>
                </label>
              );
            })}
          </div>
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该机器人暂无相机" />}
        {results.length > 0 && (
          <div className="camera-calibration-results" role="status">
            <div>下发结果：{results.filter((result) => result.success).length}/{selectedCameras.length} 台成功</div>
            <ul>{results.map((result) => (
              <li key={result.cameraId} className={result.success ? "is-success" : "is-error"}>
                {result.name}：{result.detail}
              </li>
            ))}</ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
