import { useState, useRef } from "react";
import { parsePointExcel, PointExcelRow } from "@/utils/excel-parser";

interface Result {
  time: string;
  action: string;
  ok: boolean;
  data?: any;
  error?: string;
}

export default function DbTest() {
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const api = (window as any).electronAPI;
  const db = api?.db;

  const addResult = (action: string, ok: boolean, data?: any, error?: string) => {
    setResults((prev) => [
      { time: new Date().toLocaleTimeString(), action, ok, data, error },
      ...prev.slice(0, 99),
    ]);
  };

  const run = async (label: string, fn: () => Promise<any>) => {
    setLoading(true);
    try {
      const data = await fn();
      addResult(label, true, data);
    } catch (e: any) {
      addResult(label, false, undefined, e.message);
    }
    setLoading(false);
  };

  /** 文件上传 → 解析 → 导入 */
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    try {
      setLoading(true);
      // 1. 解析 Excel
      const rows: PointExcelRow[] = await parsePointExcel(file);
      addResult("解析 Excel", true, { 行数: rows.length });

      if (rows.length === 0) {
        addResult("导入", false, undefined, "没有有效数据行");
        setLoading(false);
        return;
      }

      // 2. 调用导入（stationId 先用 1，后续可改）
      const result = await db.importPoints(rows, 1, "Excel导入厂站", "IMPORT001");
      addResult("导入完成", true, result);

      // 3. 查询确认
      const points = await db.point.list();
      addResult("查询巡检点", true, { 总数: points.length });
    } catch (e: any) {
      addResult("导入失败", false, undefined, e.message);
    }
    setLoading(false);

    // 重置 input 以便重复选同一个文件
    if (fileRef.current) fileRef.current.value = "";
  };

  const importDemo = () => {
    const rows: PointExcelRow[] = [
      { voltName: "220kV", bayName: "220kV #1间隔", mainDeviceName: "#1主变", componentName: "本体", pointName: "油位表", cruiseId: "CRUISE_001", pointCode: "P001" },
      { voltName: "220kV", bayName: "220kV #1间隔", mainDeviceName: "#1主变", componentName: "本体", pointName: "油温表", cruiseId: "CRUISE_002", pointCode: "P002" },
      { voltName: "220kV", bayName: "220kV #1间隔", mainDeviceName: "#1主变", componentName: "套管", pointName: "红外测温1", cruiseId: "CRUISE_003", pointCode: "P003" },
      { voltName: "220kV", bayName: "220kV #2间隔", mainDeviceName: "#2主变", componentName: "本体", pointName: "SF6压力表", cruiseId: "CRUISE_004", pointCode: "P004" },
      { voltName: "110kV", bayName: "110kV #1间隔", mainDeviceName: "断路器1", componentName: "机构", pointName: "分合指示", cruiseId: "CRUISE_005", pointCode: "P005" },
    ];
    run("导入演示数据", () => db.importPoints(rows, 1, "测试变电站", "TEST001"));
  };

  if (!db) {
    return (
      <div style={{ padding: 32, fontFamily: "monospace" }}>
        <h2>DB Test</h2>
        <p style={{ color: "red" }}>window.electronAPI 不存在，请在 Electron 模式下运行</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "monospace", color: "#ccc", background: "#1e1e1e", minHeight: "100vh" }}>
      <h2 style={{ color: "#fff", marginTop: 0 }}>数据库测试</h2>

      {/* 操作按钮 */}
      <div style={{ marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => run("list", () => db.station.list())} disabled={loading} style={btnStyle}>查询厂站</button>
        <button onClick={() => run("list", () => db.point.list())} disabled={loading} style={btnStyle}>查询巡检点</button>
        <button onClick={importDemo} disabled={loading} style={{ ...btnStyle, background: "#1a5c1a" }}>导入演示数据</button>
        <span style={{ color: "#888", margin: "0 8px" }}>|</span>
        <label style={{ ...btnStyle, cursor: "pointer", background: "#0055aa", display: "inline-block" }}>
          {fileName ? `已选: ${fileName}` : "选择 Excel 导入"}
          <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFile} style={{ display: "none" }} />
        </label>
      </div>

      {/* 结果列表 */}
      {results.map((r, i) => (
        <div key={i} style={{ marginBottom: 6, padding: "6px 10px", background: r.ok ? "#1a3a1a" : "#3a1a1a", borderRadius: 4, fontSize: 13, lineHeight: 1.6 }}>
          <span style={{ color: "#888" }}>{r.time}</span>{" "}
          <span style={{ color: r.ok ? "#4f4" : "#f44", fontWeight: "bold" }}>{r.action}</span>
          {r.ok ? (
            <pre style={{ margin: "4px 0 0", color: "#aaa", whiteSpace: "pre-wrap" }}>
              {JSON.stringify(r.data, null, 2)}
            </pre>
          ) : (
            <div style={{ color: "#f66" }}>{r.error}</div>
          )}
        </div>
      ))}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "6px 16px", cursor: "pointer", background: "#333",
  color: "#fff", border: "1px solid #555", borderRadius: 4, fontSize: 14,
};