import { useState, useEffect } from "react";
import { Modal, Upload, App } from "antd";
import { InboxOutlined, CheckCircleFilled, ExclamationCircleFilled } from "@ant-design/icons";
import type { UploadFile } from "antd";
import { MODEL_FILE_ACCEPT } from "../utils/space-paths";

interface Props {
  open: boolean;
  /** 当前全局选中的项目名，来自 appContextStore */
  selectedProject: string | null;
  onClose: () => void;
  /** 用户点击"导入"并通过校验后的回调，携带选中的 File 对象 */
  onConfirm: (file: File) => void;
}

/**
 * 空间模型加载弹窗。
 *
 * 设计说明：
 * - 顶部显示当前项目状态：已选中时绿色展示项目名，未选中时橙色提示前往顶部菜单栏选择。
 * - 不在弹窗内直接切换项目，避免触发 App.tsx 的 Outlet key 变更导致整页重建、弹窗消失。
 * - 支持 .las / .laz 点云文件和 .zip 空间模型包。
 * - 未选中项目或未选择文件时"导入"按钮禁用，防止无效提交。
 */
export default function LoadModelModal({ open, selectedProject, onClose, onConfirm }: Props) {
  const { message } = App.useApp();
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  // 每次弹窗打开时清空上次的文件选择，避免残留旧文件
  useEffect(() => {
    if (!open) return;
    setFileList([]);
  }, [open]);

  const handleOk = () => {
    if (!selectedProject) {
      message.warning("请先在顶部菜单栏选择项目");
      return;
    }
    const file = fileList[0]?.originFileObj;
    if (!file) {
      message.warning("请选择要导入的文件");
      return;
    }
    onConfirm(file);
    onClose();
  };

  return (
    <Modal
      title="空间模型加载"
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      okText="导入"
      cancelText="取消"
      // 未选项目或未选文件时禁用导入按钮
      okButtonProps={{ disabled: !selectedProject || fileList.length === 0 }}
      // 局部覆盖全局 body 样式，此弹窗内容不多，无需限制高度和滚动
      styles={{ body: { paddingTop: 12, maxHeight: "none", overflowY: "visible" } }}
      // 关闭时销毁内容，下次打开时重新初始化状态
      destroyOnHidden
    >
      {/* 当前项目状态提示 */}
      <div style={{ marginBottom: 12 }}>
        {selectedProject ? (
          // 已选中项目：绿色状态条
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "7px 12px", borderRadius: 6,
            background: "#f6ffed", border: "1px solid #b7eb8f",
          }}>
            <CheckCircleFilled style={{ color: "#52c41a", fontSize: 13 }} />
            <span style={{ fontSize: 13, color: "#262626" }}>{selectedProject}</span>
          </div>
        ) : (
          // 未选中项目：橙色警告条，引导用户前往顶部菜单栏操作
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "7px 12px", borderRadius: 6,
            background: "#fff7e6", border: "1px solid #ffd591",
          }}>
            <ExclamationCircleFilled style={{ color: "#fa8c16", fontSize: 13 }} />
            <span style={{ fontSize: 13, color: "#8c8c8c" }}>未选择项目，请前往顶部菜单栏选择</span>
          </div>
        )}
      </div>

      {/* 文件上传区域 */}
      <Upload.Dragger
        accept={MODEL_FILE_ACCEPT}
        multiple={false}
        maxCount={1}
        fileList={fileList}
        // 阻止 antd 自动上传，文件只在内存中暂存，由 handleOk 手动提交
        beforeUpload={() => false}
        onChange={({ fileList: list }) => setFileList(list.slice(-1))}
        onRemove={() => { setFileList([]); return true; }}
        style={{ borderRadius: 6 }}
      >
        <p style={{ margin: "8px 0 4px", color: "#8c96a5", fontSize: 28, lineHeight: 1 }}>
          <InboxOutlined />
        </p>
        <p style={{ margin: 0, fontSize: 13, color: "#595959" }}>点击或拖拽上传文件</p>
        <p style={{ margin: "4px 0 8px", fontSize: 12, color: "#a3a9b3" }}>
          支持 .las / .laz 点云文件，或 .zip 空间模型包
        </p>
      </Upload.Dragger>
    </Modal>
  );
}
