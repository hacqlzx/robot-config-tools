import type { CSSProperties, ReactNode } from "react";
import { Button, Popover } from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";

const sections = [
  {
    title: "视角操作",
    items: [
      ["鼠标左键", "旋转视角"],
      ["鼠标右键", "平移视角"],
      ["Alt + 鼠标左键拖动", "法线模式下绘制新的圆形区域"],
      ["鼠标左键拖动", "拖动圆心、圆环或箭头编辑标注"],
      ["滚轮", "以鼠标位置缩放"],
      ["W / A / S / D", "前后左右移动视角"],
      ["Q / E", "下降 / 上升视角"],
      ["Shift", "加速移动"],
      ["Alt", "慢速移动"],
    ],
  },
  {
    title: "编辑快捷键",
    items: [
      ["Ctrl + S", "保存当前编辑"],
      ["Ctrl + Z", "撤销"],
      ["Ctrl + Y", "恢复"],
      ["Ctrl + Shift + Z", "恢复"],
      ["方向键", "微调选中的充电区域或设备区域"],
      ["Delete / Backspace", "删除选中元素"],
    ],
  },
] as const;

const rootStyle: CSSProperties = {
  position: "absolute",
  top: 16,
  right: 16,
  zIndex: 12,
};

const contentStyle: CSSProperties = {
  width: 330,
  display: "grid",
  gap: 14,
  padding: "2px 0",
};

const sectionStyle: CSSProperties = {
  display: "grid",
  gap: 8,
};

const titleStyle: CSSProperties = {
  color: "#111827",
  fontSize: 13,
  fontWeight: 600,
};

const listStyle: CSSProperties = {
  display: "grid",
  gap: 6,
};

const rowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "118px 1fr",
  alignItems: "start",
  gap: 10,
  color: "#4b5563",
  fontSize: 12,
  lineHeight: 1.6,
};

const keyStyle: CSSProperties = {
  minWidth: 0,
  color: "#1f2937",
  fontFamily: "Consolas, 'SFMono-Regular', monospace",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "normal",
  wordBreak: "break-word",
};

function renderContent(): ReactNode {
  return (
    <div style={contentStyle}>
      {sections.map((section) => (
        <div key={section.title} style={sectionStyle}>
          <div style={titleStyle}>{section.title}</div>
          <div style={listStyle}>
            {section.items.map(([key, description]) => (
              <div key={key} style={rowStyle}>
                <span style={keyStyle}>{key}</span>
                <span>{description}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface Props {
  normalMode?: boolean;
}

export default function SpaceShortcutHelp({ normalMode = false }: Props) {
  return (
    <div style={rootStyle}>
      {normalMode && (
        <div
          role="status"
          style={{
            position: "absolute",
            top: 42,
            right: 0,
            width: 260,
            padding: "8px 10px",
            color: "#f9fafb",
            background: "rgba(17, 24, 39, 0.9)",
            border: "1px solid rgba(255, 255, 255, 0.16)",
            borderRadius: 4,
            boxShadow: "0 4px 14px rgba(0, 0, 0, 0.28)",
            fontSize: 12,
            lineHeight: 1.55,
            pointerEvents: "none",
          }}
        >
          法线模式：新建圆形区域需按住 <strong>Alt + 鼠标左键</strong> 拖动；已有标注可直接用鼠标左键拖动圆心、圆环或箭头编辑。
        </div>
      )}
      <Popover
        title="快捷操作"
        content={renderContent()}
        trigger="hover"
        placement="bottomRight"
        mouseEnterDelay={0.12}
      >
        <Button
          aria-label="快捷操作说明"
          title="快捷操作说明"
          shape="circle"
          icon={<QuestionCircleOutlined />}
          style={{
            width: 32,
            height: 32,
            color: "#1f2937",
            background: "rgba(255, 255, 255, 0.94)",
            boxShadow: "0 2px 10px rgba(0, 0, 0, 0.3)",
          }}
        />
      </Popover>
    </div>
  );
}
