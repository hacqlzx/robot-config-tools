import { EditOutlined } from "@ant-design/icons";
import { Spin } from "antd";
import type { CabinetTreeNode } from "../types";

export type BatchRecognitionNodeStatus = "loading" | "done";

interface CabinetTreeTitleProps {
  node: CabinetTreeNode;
  batchStatus?: BatchRecognitionNodeStatus;
  onRenameMainDevice: (node: CabinetTreeNode) => void;
}

export function CabinetTreeTitle({
  node,
  batchStatus,
  onRenameMainDevice,
}: CabinetTreeTitleProps) {
  const title = node.title;

  if (node.nodeType === "component") {
    return (
      <span className="screen-verify-tree-title screen-verify-tree-title-status" title={title}>
        {batchStatus ? (
          <span className={`screen-verify-tree-batch-state is-${batchStatus}`}>
            {batchStatus === "loading" ? <Spin size="small" /> : "√"}
          </span>
        ) : null}
        <span className="screen-verify-tree-title-text">{title}</span>
      </span>
    );
  }

  if (node.nodeType !== "main") {
    return <span className="screen-verify-tree-title" title={title}>{title}</span>;
  }

  return (
    <span className="screen-verify-tree-title screen-verify-tree-title-editable">
      <span className="screen-verify-tree-title-text" title={title}>{title}</span>
      <button
        type="button"
        className="screen-verify-tree-rename"
        title="修改屏柜名称"
        onClick={(event) => {
          event.stopPropagation();
          onRenameMainDevice(node);
        }}
      >
        <EditOutlined />
      </button>
    </span>
  );
}
