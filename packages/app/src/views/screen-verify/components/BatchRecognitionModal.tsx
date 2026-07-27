import { Modal, Progress, Radio } from "antd";

export type BatchRecognitionMode = "all" | "new";

export interface BatchRecognitionProgress {
  mode: BatchRecognitionMode;
  current: number;
  total: number;
  currentName: string;
  success: number;
  failed: number;
  skipped: number;
}

interface BatchRecognitionModalProps {
  open: boolean;
  mode: BatchRecognitionMode;
  progress: BatchRecognitionProgress | null;
  onModeChange: (mode: BatchRecognitionMode) => void;
  onStart: () => void;
  onCancel: () => void;
}

export function BatchRecognitionModal({
  open,
  mode,
  progress,
  onModeChange,
  onStart,
  onCancel,
}: BatchRecognitionModalProps) {
  return (
    <Modal
      title="批量识别"
      open={open}
      centered
      onOk={onStart}
      onCancel={onCancel}
      okText="开始识别"
      cancelText="取消"
      okButtonProps={{ disabled: Boolean(progress) }}
      cancelButtonProps={{ disabled: Boolean(progress) }}
      closable={!progress}
      maskClosable={!progress}
      destroyOnHidden
    >
      <div className="screen-verify-batch-modal">
        <Radio.Group
          className="screen-verify-batch-mode"
          value={mode}
          disabled={Boolean(progress)}
          onChange={(event) => onModeChange(event.target.value)}
        >
          <Radio value="all">识别全部屏柜</Radio>
          <Radio value="new">识别新标注屏柜</Radio>
        </Radio.Group>
        {progress ? (
          <div className="screen-verify-batch-progress">
            <Progress
              percent={Math.round((progress.current / Math.max(1, progress.total)) * 100)}
              size="small"
              status="active"
            />
            <div className="screen-verify-batch-current" title={progress.currentName}>
              {progress.current}/{progress.total} {progress.currentName}
            </div>
            <div className="screen-verify-batch-summary">
              成功 {progress.success}，跳过 {progress.skipped}，失败 {progress.failed}
            </div>
          </div>
        ) : (
          <div className="screen-verify-batch-desc">
            按左侧树中的部件顺序逐张识别，识别完成后会保存当前中间态数据。
          </div>
        )}
      </div>
    </Modal>
  );
}
