import { EditOutlined } from "@ant-design/icons";
import { Empty, Input, Modal, Radio } from "antd";
import { useEffect, useMemo, useState } from "react";
import { targetTypeOptions } from "../utils/constants";
import type { TargetTypeOption } from "../utils/constants";

interface TargetTypeModalProps {
  open: boolean;
  value?: string;
  onCancel: () => void;
  onSubmit: (option: TargetTypeOption) => void;
}

export function TargetTypeModal({ open, value, onCancel, onSubmit }: TargetTypeModalProps) {
  const [keyword, setKeyword] = useState("");
  const [selectedValue, setSelectedValue] = useState(value || "");

  useEffect(() => {
    if (!open) return;
    setKeyword("");
    setSelectedValue(value || "");
  }, [open, value]);

  const filteredOptions = useMemo(() => {
    const trimmed = keyword.trim().toLowerCase();
    if (!trimmed) return targetTypeOptions;
    return targetTypeOptions.filter((option) => (
      option.value.toLowerCase().includes(trimmed)
      || option.label.toLowerCase().includes(trimmed)
      || option.deviceName.toLowerCase().includes(trimmed)
      || option.algorithmName.toLowerCase().includes(trimmed)
      || String(option.algorithmType).includes(trimmed)
      || String(option.index).includes(trimmed)
    ));
  }, [keyword]);

  const selectedOption = targetTypeOptions.find((option) => option.value === selectedValue);

  return (
    <Modal
      title={(
        <span className="screen-verify-target-type-title">
          <EditOutlined />
          <span>选择目标类型</span>
        </span>
      )}
      open={open}
      centered
      width={980}
      className="screen-verify-target-type-modal"
      destroyOnHidden
      okText="确定"
      cancelText="取消"
      okButtonProps={{ disabled: !selectedOption }}
      onCancel={onCancel}
      onOk={() => {
        if (selectedOption) onSubmit(selectedOption);
      }}
    >
      <Input
        autoFocus
        allowClear
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
      />
      <div className="screen-verify-target-type-list">
        {filteredOptions.length ? (
          <Radio.Group
            value={selectedValue}
            onChange={(event) => setSelectedValue(event.target.value)}
          >
            <div className="screen-verify-target-type-grid">
              {filteredOptions.map((option) => (
                <Radio
                  key={option.value}
                  value={option.value}
                  title={option.label}
                >
                  {option.label}
                </Radio>
              ))}
            </div>
          </Radio.Group>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到目标类型" />
        )}
      </div>
    </Modal>
  );
}
