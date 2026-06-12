import { useState, useRef } from "react";
import { Input } from "antd";

interface Props {
  value?: string;
  onChange?: (val: string) => void;
}

export default function IpInput({ value, onChange }: Props) {
  const parts = (value || "").split(".");
  const refs = useRef<any[]>([]);
  const [vals, setVals] = useState([parts[0] || "", parts[1] || "", parts[2] || "", parts[3] || ""]);

  const emit = (next: string[]) => {
    const ip = next.join(".");
    next.every((n) => n !== "") ? onChange?.(ip) : onChange?.("");
  };

  const handleChange = (index: number, raw: string) => {
    const digits = raw.replace(/\D/g, "");
    if (digits.length >= 3) {
      const overflow = digits.slice(3);
      const next = [...vals];
      next[index] = digits.slice(0, 3);
      setVals(next); emit(next);
      if (overflow && index < 3) {
        const next2 = [...next];
        next2[index + 1] = overflow;
        setVals(next2); emit(next2);
        if (overflow.length >= 3 && index < 2) refs.current[index + 2]?.focus();
        else refs.current[index + 1]?.focus();
      }
      return;
    }
    const next = [...vals];
    next[index] = digits;
    setVals(next); emit(next);
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "." || e.key === "ArrowRight") { e.preventDefault(); if (index < 3) refs.current[index + 1]?.focus(); }
    else if (e.key === "ArrowLeft" && index > 0 && !vals[index]) refs.current[index - 1]?.focus();
    else if (e.key === "Backspace" && !vals[index] && index > 0) refs.current[index - 1]?.focus();
  };

  const inputStyle: React.CSSProperties = { width: 52, textAlign: "center", padding: "4px 0", border: "none", outline: "none", background: "transparent", boxShadow: "none" };

  return (
    <div style={{ display: "inline-flex", alignItems: "center", border: "1px solid #d9d9d9", borderRadius: 6, padding: "0 8px", background: "#fff" }}>
      {vals.map((v, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center" }}>
          <Input ref={(el: any) => (refs.current[i] = el)} value={v} onChange={(e) => handleChange(i, e.target.value)} onKeyDown={(e) => handleKeyDown(i, e)} style={inputStyle} maxLength={4} placeholder="0" />
          {i < 3 && <span style={{ color: "#bfbfbf", userSelect: "none" }}>.</span>}
        </span>
      ))}
    </div>
  );
}
