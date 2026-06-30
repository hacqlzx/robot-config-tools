import * as XLSX from "xlsx-js-style";
import type { DevicePoint } from "@robot/database";
import * as fs from "fs";
import * as path from "path";
import { ZipArchive } from "archiver";
import { Transform } from "stream";

// 逆向映射
const RECOGNITION_REV: Record<string, string> = {
  "meter_read": "表计读取", "position_state": "位置状态识别",
  "appearance": "设备外观查看", "sound": "声音检测",
  "ir_temp": "红外测温", "visible": "可见光查看",
};
const SAVE_REV: Record<number, string> = { 1: "可见光照", 2: "红外图谱", 3: "音频", 4: "可见光+红外" };
const METER_REV: Record<number, string> = { 1: "油位表", 2: "避雷器动作次数表", 3: "泄漏电流表", 4: "SF6压力表", 5: "液压表", 6: "油温表", 7: "档位表" };
const POS_REV: Record<number, string> = { 1: "断路器状态", 2: "接地刀闸状态", 3: "隔离刀闸状态" };
const LEVEL_REV: Record<number, string> = { 1: "Ⅰ类", 2: "Ⅱ类", 3: "Ⅲ类" };
const DEVICE_TYPE_REV: Record<number, string> = {
  1: "油浸式变压器(电抗器)", 2: "断路器", 3: "组合电器", 4: "隔离开关",
  5: "电压互感器", 6: "电流互感器", 7: "避雷器", 8: "电容器",
  9: "电抗器", 10: "开关柜", 29: "二次屏柜",
};
const PHASE_REV: Record<number, string> = { 0: "主体", 1: "A相", 2: "B相", 3: "C相" };
const INSPECTION_REV: Record<string, string> = {
  "101": "例行巡检", "201": "气温骤变特巡", "202": "高温特巡", "203": "雾霾特巡",
  "204": "大风特巡", "205": "下雪特巡", "206": "覆冰特巡", "207": "雷暴特巡",
  "208": "大负荷特巡", "209": "雨后特巡", "210": "冰雹特巡", "211": "沙尘暴特巡",
  "212": "雪后特巡", "213": "缺陷跟踪", "214": "新设备投运", "215": "重新投运",
  "216": "远方异常告警确认", "217": "协助应急事故处理", "218": "安防联动",
  "219": "保供电任务", "220": "远方状态确认", "221": "鸟巢特巡",
  "301": "设备红外测温", "302": "油位油温表抄录", "303": "避雷器表计抄录",
  "304": "SF6压力表抄录", "305": "液压表抄录", "306": "位置状态识别",
  "307": "调压档位抄录", "401": "自定义巡检", "501": "熄灯巡检",
};

const EXPORT_COLS = [
  "*点位名称", "点位编码", "巡检点ID",
  "*识别类型1", "识别类型2",
  "采集类型", "表计类型", "位置状态类型",
  "*重要等级",
  "*部件名称", "部件编码",
  "*主设备名称", "主设备编码", "*主设备类型",
  "*相位",
  "*间隔名称", "间隔编码", "*间隔类型",
  "*区域", "区域编码",
  "巡视类型1", "巡视类型2", "巡视类型3", "巡视类型4",
  "巡视类型5", "巡视类型6", "巡视类型7", "巡视类型8",
];

const IMPORT_TIPS = `1、加*号的必填；
2、点位名称、部件名称、主设备名称、间隔名称、电压区域填写校验规则：长度为2-50位的字符，可输入中文 大小写字母 数字 罗马数字 、. # _ - ( ) （ ），且不以_result结尾；
3、编码未填写时导入自动生成；
4、识别类型1、识别类型2都为识别类型，点位有两个识别类型时分别填入；
5、识别类型、表计类型、位置状态类型、主设备类型、相位、电压区域通过下拉选择，若位置状态类型、电压区域发生变化修改方式参考表'下拉选项变更操作说明'；
6、重要等级未填写时默认为Ⅰ类；`;

function generatePointExcel(points: DevicePoint[]): Buffer {
  const rows: Record<string, string>[] = [];
  for (const p of points) {
    const recogList = (p.recognitionTypeList || "").split(",").map((s) => RECOGNITION_REV[s.trim()] || s).filter(Boolean);
    const inspects = (p.inspectionSubType || "").split(",").map((s) => INSPECTION_REV[s.trim()] || s).filter(Boolean);
    rows.push({
      "*点位名称": p.pointName || "", "点位编码": p.pointCode || "", "巡检点ID": p.cruiseId || "",
      "*识别类型1": recogList[0] || "", "*识别类型2": recogList[1] || "",
      "采集类型": SAVE_REV[p.saveTypeList] || (p.saveTypeList ? String(p.saveTypeList) : ""),
      "表计类型": METER_REV[p.meterType] || (p.meterType ? String(p.meterType) : ""),
      "位置状态类型": POS_REV[p.positionStateType] || (p.positionStateType ? String(p.positionStateType) : ""),
      "*重要等级": LEVEL_REV[p.importantLevel] || (p.importantLevel ? String(p.importantLevel) : ""),
      "*部件名称": p.componentName || "", "部件编码": p.componentCode || "",
      "*主设备名称": p.mainDeviceName || "", "主设备编码": p.mainDeviceCode || "",
      "*主设备类型": DEVICE_TYPE_REV[p.mainDeviceType] || (p.mainDeviceType ? String(p.mainDeviceType) : ""),
      "*相位": PHASE_REV[p.phaseType] || (p.phaseType !== undefined ? String(p.phaseType) : ""),
      "*间隔名称": p.bayName || "", "间隔编码": p.bayCode || "", "*间隔类型": p.bayType || "",
      "*区域": p.voltName || "", "区域编码": p.voltCode || "",
      "巡视类型1": inspects[0] || "", "巡视类型2": inspects[1] || "", "巡视类型3": inspects[2] || "", "巡视类型4": inspects[3] || "",
      "巡视类型5": inspects[4] || "", "巡视类型6": inspects[5] || "", "巡视类型7": inspects[6] || "", "巡视类型8": inspects[7] || "",
    });
  }

  // 构建数据：第1行=提示, 第2行=表头, 后续=数据
  const headerRow = EXPORT_COLS;
  const dataRows = rows.map((r) => headerRow.map((c) => r[c]));
  const allData: any[][] = [
    [IMPORT_TIPS],
    headerRow,
    ...dataRows,
  ];

  const ws = XLSX.utils.aoa_to_sheet(allData);

  // 提示行：合并所有列，自动换行，加高
  const colCount = headerRow.length;
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } }];
  ws["A1"] = { t: "s", v: IMPORT_TIPS, s: { alignment: { wrapText: true, vertical: "top" } } };

  // 表头行：灰底 (#C0C0C0)，居中加粗，加高
  const headerStyle = {
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    fill: { fgColor: { rgb: "C0C0C0" } },
    font: { bold: true },
  };
  for (let c = 0; c < colCount; c++) {
    const cellRef = XLSX.utils.encode_cell({ r: 1, c });
    if (!ws[cellRef]) ws[cellRef] = { t: "s", v: headerRow[c] };
    ws[cellRef].s = headerStyle;
  }

  // 行高
  ws["!rows"] = [
    { hpx: 80 },   // 提示行
    { hpx: 36 },   // 表头行
  ];

  ws["!cols"] = EXPORT_COLS.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return Buffer.from(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

/** 递归计算目录总字节数 */
function getDirSize(dir: string): number {
  let size = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) size += getDirSize(p);
    else size += fs.statSync(p).size;
  }
  return size;
}

export interface ExportZipResult {
  zipPath: string;
  zipName: string;
}

/** 进度回调类型 */
export type ProgressCallback = (step: string, pct: number) => void;

export async function exportSpaceZip(
  projectName: string,
  projectRoot: string,
  points: DevicePoint[],
  mapDirs: string[],
  includePointTable: boolean,
  destDir: string,
  onProgress?: ProgressCallback,
): Promise<ExportZipResult> {
  const stationName = points.length > 0 ? (points[0].stationName || "未知厂站") : "未知厂站";
  const mapNames = mapDirs.join("_");
  const now = new Date();
  const timeStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const zipName = `${stationName}_${mapNames}_${timeStr}`;

  // Step 1: 生成点表 Excel（内存中，不写磁盘）
  let xlsxBuf: Buffer | null = null;
  if (includePointTable && points.length > 0) {
    onProgress?.("生成点表...", 1);
    xlsxBuf = generatePointExcel(points);
  }

  // Step 2: 计算源文件总大小（直接统计源目录，不复制）
  onProgress?.("计算文件大小...", 2);
  let totalSize = 0;
  if (xlsxBuf) totalSize += xlsxBuf.length;
  const mapRoot = path.join(projectRoot, projectName, "地图");
  for (const dirName of mapDirs) {
    const src = path.join(mapRoot, dirName);
    if (fs.existsSync(src)) totalSize += getDirSize(src);
  }
  const totalMB = totalSize / 1024 / 1024;

  // 自动编号防重名
  let zipPath = path.join(destDir, `${zipName}.zip`);
  if (fs.existsSync(zipPath)) {
    let i = 1;
    while (fs.existsSync(zipPath)) {
      zipPath = path.join(destDir, `${zipName}_${i}.zip`);
      i++;
    }
  }

  // Step 3: 流式压缩（直接从源读取，无临时目录）
  onProgress?.(`压缩中  (共 ${totalMB.toFixed(0)}MB)...`, 3);
  const output = fs.createWriteStream(zipPath);

  let outBytes = 0;
  const progressStream = new Transform({
    transform(chunk, _encoding, cb) {
      outBytes += chunk.length;
      const processedMB = outBytes / 1024 / 1024;
      const pct = totalSize > 0
        ? 3 + Math.round((outBytes / totalSize) * 96)
        : 3;
      onProgress?.(
        `压缩中  ${processedMB.toFixed(0)}/${totalMB.toFixed(0)}MB`,
        Math.min(99, pct),
      );
      cb(null, chunk);
    },
  });

  // store 模式：点云数据再压缩收益极低，仅归档不压缩
  const archive = new ZipArchive({ zlib: { level: 0 } });
  archive.pipe(progressStream).pipe(output);

  // 点表：直接追加内存 buffer，不写磁盘
  if (xlsxBuf) {
    archive.append(xlsxBuf, { name: `${stationName}_巡检点位.xlsx` });
  }

  // 地图：直接从源目录读取
  for (const dirName of mapDirs) {
    const src = path.join(mapRoot, dirName);
    if (fs.existsSync(src)) {
      archive.directory(src, `地图/${dirName}`);
    }
  }

  await Promise.all([
    archive.finalize(),
    new Promise<void>((resolve) => output.on("close", resolve)),
  ]);

  onProgress?.("完成", 100);
  return { zipPath, zipName: path.basename(zipPath, ".zip") };
}
