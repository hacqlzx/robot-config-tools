import * as XLSX from "xlsx-js-style";
import type { DeviceBay, DeviceComponent, DeviceMain, DevicePoint, DeviceVoltage } from "@robot/database";
import * as fs from "fs";
import * as path from "path";
import { ZipArchive } from "archiver";
import { Transform } from "stream";

const MAP_MODEL_FILE_NAME = "map.las";
const MAP_INFO_FILE_NAME = "map_info.json";
const DESCRIPTION_FILE_NAME = "description_file.json";
const REFERENCE_PATH_FILE_NAME = "reference_path.txt";
const LEGACY_REFERENCE_PATH_FILE_NAME = "可行驶路径.json";
const MAP_MODEL_EXT_RE = /\.(las|laz)$/i;
const AREA_TYPE_CABINET_ROW = "1";
const AREA_TYPE_CABINET = "2";
const MAIN_DEVICE_TYPE_CABINET = 29;

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
  "*点位名称", "点位编码",
  "*识别类型1", "识别类型2",
  "采集类型", "表计类型", "位置状态类型",
  "重要等级",
  "*部件名称", "部件编码",
  "*主设备名称", "主设备编码", "*主设备类型",
  "*相位",
  "*间隔名称", "间隔编码", "间隔类型",
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

export type PointExcelExportRow = Record<string, unknown>;

export interface GeneratePointExcelOptions {
  extraColumns?: string[];
  sheetName?: string;
}

export interface PointTableExportData {
  points: DevicePoint[];
  components: DeviceComponent[];
  mains: DeviceMain[];
  bays: DeviceBay[];
  voltages: DeviceVoltage[];
}

function blankExportRow(): Record<string, string> {
  return Object.fromEntries(EXPORT_COLS.map((col) => [col, ""]));
}

function pointExportRow(p: DevicePoint): Record<string, string> {
    const recogList = (p.recognitionTypeList || "").split(",").map((s) => RECOGNITION_REV[s.trim()] || s).filter(Boolean);
    const inspects = (p.inspectionSubType || "").split(",").map((s) => INSPECTION_REV[s.trim()] || s).filter(Boolean);
    return {
      ...blankExportRow(),
      "*点位名称": p.pointName || "", "点位编码": p.pointCode || "",
      "*识别类型1": recogList[0] || "", "识别类型2": recogList[1] || "",
      "采集类型": SAVE_REV[p.saveTypeList] || (p.saveTypeList ? String(p.saveTypeList) : ""),
      "表计类型": METER_REV[p.meterType] || (p.meterType ? String(p.meterType) : ""),
      "位置状态类型": POS_REV[p.positionStateType] || (p.positionStateType ? String(p.positionStateType) : ""),
      "重要等级": LEVEL_REV[p.importantLevel] || (p.importantLevel ? String(p.importantLevel) : ""),
      "*部件名称": p.componentName || "", "部件编码": p.componentCode || "",
      "*主设备名称": p.mainDeviceName || "", "主设备编码": p.mainDeviceCode || "",
      "*主设备类型": DEVICE_TYPE_REV[p.mainDeviceType] || (p.mainDeviceType ? String(p.mainDeviceType) : ""),
      "*相位": PHASE_REV[p.phaseType] || (p.phaseType !== undefined ? String(p.phaseType) : ""),
      "*间隔名称": p.bayName || "", "间隔编码": p.bayCode || "", "间隔类型": p.bayType || "",
      "*区域": p.voltName || "", "区域编码": p.voltCode || "",
      "巡视类型1": inspects[0] || "", "巡视类型2": inspects[1] || "", "巡视类型3": inspects[2] || "", "巡视类型4": inspects[3] || "",
      "巡视类型5": inspects[4] || "", "巡视类型6": inspects[5] || "", "巡视类型7": inspects[6] || "", "巡视类型8": inspects[7] || "",
    };
}

function componentExportRow(c: DeviceComponent): Record<string, string> {
  return {
    ...blankExportRow(),
    "*部件名称": c.componentName || "", "部件编码": c.componentCode || "",
    "*主设备名称": c.mainDeviceName || "", "主设备编码": c.mainDeviceCode || "",
    "*主设备类型": DEVICE_TYPE_REV[c.mainDeviceType] || (c.mainDeviceType ? String(c.mainDeviceType) : ""),
    "*相位": PHASE_REV[c.phaseType] || (c.phaseType !== undefined ? String(c.phaseType) : ""),
    "*间隔名称": c.bayName || "", "间隔编码": c.bayCode || "", "间隔类型": c.bayType || "",
    "*区域": c.voltName || "", "区域编码": c.voltCode || "",
  };
}

function mainExportRow(m: DeviceMain): Record<string, string> {
  return {
    ...blankExportRow(),
    "*主设备名称": m.mainDeviceName || "", "主设备编码": m.mainDeviceCode || "",
    "*主设备类型": DEVICE_TYPE_REV[m.mainDeviceType] || (m.mainDeviceType ? String(m.mainDeviceType) : ""),
    "*相位": PHASE_REV[m.phaseType] || (m.phaseType !== undefined ? String(m.phaseType) : ""),
    "*间隔名称": m.bayName || "", "间隔编码": m.bayCode || "", "间隔类型": m.bayType || "",
    "*区域": m.voltName || "", "区域编码": m.voltCode || "",
  };
}

function bayExportRow(b: DeviceBay): Record<string, string> {
  return {
    ...blankExportRow(),
    "*间隔名称": b.bayName || "", "间隔编码": b.bayCode || "", "间隔类型": b.bayType || "",
    "*区域": b.voltName || "", "区域编码": b.voltCode || "",
  };
}

function voltageExportRow(v: DeviceVoltage): Record<string, string> {
  return {
    ...blankExportRow(),
    "*区域": v.voltName || "", "区域编码": v.voltCode || "",
  };
}

function buildPointExportRows(data: PointTableExportData): Record<string, string>[] {
  const rows = data.points.map(pointExportRow);

  const pointComponentIds = new Set(data.points.map((p) => p.componentId).filter((id) => id > 0));
  const componentMainIds = new Set(data.components.map((c) => c.mainDeviceId).filter((id) => id > 0));
  const mainBayIds = new Set(data.mains.map((m) => m.bayId).filter((id) => id > 0));
  const bayVoltIds = new Set(data.bays.map((b) => b.voltId).filter((id) => id > 0));

  for (const component of data.components) {
    if (!pointComponentIds.has(component.id)) rows.push(componentExportRow(component));
  }
  for (const main of data.mains) {
    if (!componentMainIds.has(main.id)) rows.push(mainExportRow(main));
  }
  for (const bay of data.bays) {
    if (!mainBayIds.has(bay.id)) rows.push(bayExportRow(bay));
  }
  for (const voltage of data.voltages) {
    if (!bayVoltIds.has(voltage.id)) rows.push(voltageExportRow(voltage));
  }

  return rows;
}

function getStationName(data: PointTableExportData): string {
  return data.points[0]?.stationName
    || data.components[0]?.stationName
    || data.mains[0]?.stationName
    || data.bays[0]?.stationName
    || data.voltages[0]?.stationName
    || "未知厂站";
}

export function generatePointExcelFromRows(rows: PointExcelExportRow[], options: GeneratePointExcelOptions = {}): Buffer {
  // 构建数据：第1行=提示, 第2行=表头, 后续=数据
  const extraColumns = (options.extraColumns || []).filter((col) => col && !EXPORT_COLS.includes(col));
  const headerRow = [...EXPORT_COLS, ...extraColumns];
  const dataRows = rows.map((r) => headerRow.map((c) => r[c] ?? ""));
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

  ws["!cols"] = headerRow.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, options.sheetName || "Sheet1");
  return Buffer.from(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

function generatePointExcel(data: PointTableExportData): Buffer {
  return generatePointExcelFromRows(buildPointExportRows(data));
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

function listFilesRecursive(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFilesRecursive(p));
    else files.push(p);
  }
  return files;
}

function toZipPath(...parts: string[]): string {
  return parts.join("/").replace(/\\/g, "/");
}

function directChildPriority(root: string, filePath: string): number {
  const rel = path.relative(root, filePath).replace(/\\/g, "/");
  const direct = !rel.includes("/");
  const base = path.basename(filePath).toLowerCase();
  if (direct && base === MAP_MODEL_FILE_NAME) return 0;
  if (direct && MAP_MODEL_EXT_RE.test(base)) return 1;
  return 2;
}

function formatMapInfoTime(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildMapInfo(mapName: string, existingText: string | null): string {
  let mapCode = "";
  if (existingText) {
    try {
      const parsed = JSON.parse(existingText);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        mapCode = typeof parsed.map_code === "string" ? parsed.map_code.trim() : "";
      }
    } catch {}
  }

  const data: Record<string, string> = {};
  if (mapCode) data.map_code = mapCode;
  data.map_name = mapName;
  data.time = formatMapInfoTime();
  return `${JSON.stringify(data, null, 2)}\n`;
}

function textValue(value: unknown): string {
  return String(value ?? "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function areaType(record: Record<string, unknown>): string {
  return textValue(record.type);
}

function splitTextList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => splitTextList(item));
  return textValue(value)
    .split(/[,，;；|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueTexts(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function bayCodesFromRecord(record: Record<string, unknown>): string[] {
  return uniqueTexts([...splitTextList(record.bay_code), ...splitTextList(record.bay_codes)]);
}

function applyBayCodeField(record: Record<string, unknown>, bayCodes: string[]): void {
  const codes = uniqueTexts(bayCodes);
  delete record.bay_name;
  delete record.bay_names;
  delete record.bay_codes;
  if (codes.length > 0) record.bay_code = codes[0];
}

function buildMainLookup(mains: DeviceMain[]) {
  const byCode = new Map<string, DeviceMain>();
  const names = new Map<string, DeviceMain[]>();
  for (const main of mains.filter((item) => item.mainDeviceType === MAIN_DEVICE_TYPE_CABINET)) {
    const code = textValue(main.mainDeviceCode);
    if (code && !byCode.has(code)) byCode.set(code, main);

    const name = textValue(main.mainDeviceName);
    if (name) {
      const list = names.get(name) || [];
      list.push(main);
      names.set(name, list);
    }
  }
  return { byCode, names };
}

function findMainForArea(record: Record<string, unknown>, lookup: ReturnType<typeof buildMainLookup>): DeviceMain | null {
  const code = textValue(record.code);
  if (code) {
    const byCode = lookup.byCode.get(code);
    if (byCode) return byCode;
  }

  const name = textValue(record.name);
  if (!name) return null;
  const byName = lookup.names.get(name) || [];
  return byName.length === 1 ? byName[0] : null;
}

function descriptionTextWithBayCode(existingText: string, data: PointTableExportData): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(existingText);
  } catch {
    return existingText;
  }
  if (!Array.isArray(parsed)) return existingText;

  const records = parsed
    .filter(isRecord)
    .map((record) => ({ ...record }));
  if (records.length !== parsed.length) return existingText;

  const lookup = buildMainLookup(data.mains || []);
  const childrenByParent = new Map<string, Record<string, unknown>[]>();
  for (const record of records) {
    if (areaType(record) !== AREA_TYPE_CABINET) continue;
    const parentId = textValue(record.parent_id);
    if (!parentId) continue;
    const children = childrenByParent.get(parentId) || [];
    children.push(record);
    childrenByParent.set(parentId, children);
  }

  for (const record of records) {
    const type = areaType(record);
    if (type !== AREA_TYPE_CABINET_ROW && type !== AREA_TYPE_CABINET) continue;
    applyBayCodeField(record, bayCodesFromRecord(record));
    const main = findMainForArea(record, lookup);
    if (!main) continue;
    applyBayCodeField(record, [textValue(main.bayCode)]);
  }

  for (const record of records) {
    if (areaType(record) !== AREA_TYPE_CABINET_ROW) continue;
    const children = childrenByParent.get(textValue(record.id)) || [];
    const bayCodes = uniqueTexts([
      ...bayCodesFromRecord(record),
      ...children.flatMap((child) => bayCodesFromRecord(child)),
    ]);
    applyBayCodeField(record, bayCodes);
    if (bayCodes.length === 1) {
      for (const child of children) {
        if (bayCodesFromRecord(child).length === 0) applyBayCodeField(child, bayCodes);
      }
    }
  }

  return `${JSON.stringify(records, null, 2)}\n`;
}

interface CabinetRegionRef {
  mainDeviceCode: string;
  regionId: string;
}

interface PointExtendRecord {
  point_code: string;
  calibration_id: string;
  cruise_id: string;
  main_device_code: string;
  region_id: string;
}

function collectCabinetRegions(mapRoot: string, mains: DeviceMain[]): CabinetRegionRef[] {
  const result: CabinetRegionRef[] = [];
  const seen = new Set<string>();
  const mainLookup = buildMainLookup(mains);
  if (!fs.existsSync(mapRoot)) return result;

  const descriptionFiles = listFilesRecursive(mapRoot)
    .filter((filePath) => path.basename(filePath).toLowerCase() === DESCRIPTION_FILE_NAME)
    .sort((a, b) => a.localeCompare(b));

  for (const filePath of descriptionFiles) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;

    for (const value of parsed) {
      if (!isRecord(value)) continue;
      const type = areaType(value);
      if (type !== AREA_TYPE_CABINET) continue;
      const mainDeviceCode = textValue(value.code) || textValue(findMainForArea(value, mainLookup)?.mainDeviceCode);
      const regionId = textValue(value.id);
      if (!mainDeviceCode && !regionId) continue;
      const key = mainDeviceCode ? `code:${mainDeviceCode}` : `region:${regionId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ mainDeviceCode, regionId });
    }
  }

  return result;
}

function buildPointExtendRecords(
  points: DevicePoint[],
  mains: DeviceMain[],
  cabinetRegions: CabinetRegionRef[],
): PointExtendRecord[] {
  const regionIndexesByMainCode = new Map<string, number[]>();
  cabinetRegions.forEach((region, index) => {
    if (!region.mainDeviceCode) return;
    const indexes = regionIndexesByMainCode.get(region.mainDeviceCode) || [];
    indexes.push(index);
    regionIndexesByMainCode.set(region.mainDeviceCode, indexes);
  });

  const usedRegionIndexes = new Set<number>();
  const pointMainCodes = new Set<string>();
  const records: PointExtendRecord[] = points.map((point) => {
    const mainDeviceCode = textValue(point.mainDeviceCode);
    if (mainDeviceCode) pointMainCodes.add(mainDeviceCode);
    const regionIndex = mainDeviceCode ? regionIndexesByMainCode.get(mainDeviceCode)?.[0] : undefined;
    if (regionIndex !== undefined) usedRegionIndexes.add(regionIndex);
    return {
      point_code: textValue(point.pointCode),
      calibration_id: textValue(point.calibrationId),
      cruise_id: textValue(point.cruiseId),
      main_device_code: mainDeviceCode,
      region_id: regionIndex === undefined ? "" : cabinetRegions[regionIndex].regionId,
    };
  });

  const addedCabinetCodes = new Set<string>();
  for (const main of mains) {
    if (main.mainDeviceType !== MAIN_DEVICE_TYPE_CABINET) continue;
    const mainDeviceCode = textValue(main.mainDeviceCode);
    if (mainDeviceCode && (pointMainCodes.has(mainDeviceCode) || addedCabinetCodes.has(mainDeviceCode))) continue;
    if (mainDeviceCode) addedCabinetCodes.add(mainDeviceCode);

    const regionIndex = mainDeviceCode ? regionIndexesByMainCode.get(mainDeviceCode)?.[0] : undefined;
    if (regionIndex !== undefined) usedRegionIndexes.add(regionIndex);
    records.push({
      point_code: "",
      calibration_id: "",
      cruise_id: "",
      main_device_code: mainDeviceCode,
      region_id: regionIndex === undefined ? "" : cabinetRegions[regionIndex].regionId,
    });
  }

  cabinetRegions.forEach((region, index) => {
    if (usedRegionIndexes.has(index)) return;
    records.push({
      point_code: "",
      calibration_id: "",
      cruise_id: "",
      main_device_code: region.mainDeviceCode,
      region_id: region.regionId,
    });
  });

  return records;
}

function appendMapContents(archive: ZipArchive, src: string, mapName: string, data: PointTableExportData) {
  const added = new Set<string>();
  let mapInfoText: string | null = null;

  const files = listFilesRecursive(src).sort((a, b) => {
    const pa = directChildPriority(src, a);
    const pb = directChildPriority(src, b);
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b);
  });

  for (const filePath of files) {
    const rel = path.relative(src, filePath).replace(/\\/g, "/");
    const base = path.basename(filePath);
    const lowerBase = base.toLowerCase();
    const direct = !rel.includes("/");

    if (direct && lowerBase === MAP_INFO_FILE_NAME) {
      mapInfoText = fs.readFileSync(filePath, "utf-8");
      continue;
    }

    let outputRel = rel;
    if (direct && MAP_MODEL_EXT_RE.test(base)) outputRel = MAP_MODEL_FILE_NAME;
    else if (base === LEGACY_REFERENCE_PATH_FILE_NAME) outputRel = toZipPath(path.dirname(rel) === "." ? "" : path.dirname(rel), REFERENCE_PATH_FILE_NAME).replace(/^\//, "");

    if (added.has(outputRel)) continue;
    added.add(outputRel);
    if (base === DESCRIPTION_FILE_NAME) {
      archive.append(descriptionTextWithBayCode(fs.readFileSync(filePath, "utf-8"), data), { name: outputRel });
      continue;
    }
    archive.file(filePath, { name: outputRel });
  }

  archive.append(buildMapInfo(mapName, mapInfoText), { name: MAP_INFO_FILE_NAME });
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
  pointTableData: PointTableExportData,
  mapDirs: string[],
  destDir: string,
  onProgress?: ProgressCallback,
): Promise<ExportZipResult> {
  const pointRows = buildPointExportRows(pointTableData);
  const stationName = getStationName(pointTableData);
  console.log("[导出点表] 层级补齐统计", {
    points: pointTableData.points.length,
    components: pointTableData.components.length,
    mains: pointTableData.mains.length,
    bays: pointTableData.bays.length,
    voltages: pointTableData.voltages.length,
    exportRows: pointRows.length,
  });
  if (mapDirs.length !== 1) {
    throw new Error("请先在左侧地图树加载一个模型后再导出");
  }

  const mapName = mapDirs[0];
  const now = new Date();
  const timeStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const zipName = `${stationName}_${mapName}_${timeStr}`;
  const mapRoot = path.join(projectRoot, projectName, "地图");
  const src = path.join(mapRoot, mapName);
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
    throw new Error(`地图不存在：${mapName}`);
  }

  const xlsxBuf = generatePointExcel(pointTableData);
  const cabinetRegions = collectCabinetRegions(mapRoot, pointTableData.mains);
  const extendRecords = buildPointExtendRecords(pointTableData.points, pointTableData.mains, cabinetRegions);
  const extendText = `${JSON.stringify(extendRecords, null, 2)}\n`;

  onProgress?.("准备导出文件...", 1);
  console.log("[导出点表] extend.json 统计", {
    points: pointTableData.points.length,
    databaseCabinets: pointTableData.mains.filter((main) => main.mainDeviceType === MAIN_DEVICE_TYPE_CABINET).length,
    mappedCabinetRegions: cabinetRegions.length,
    records: extendRecords.length,
  });

  // Step 1: 计算最终导出包需要读取的文件大小。
  onProgress?.("计算文件大小...", 2);
  const totalSize = getDirSize(src) + xlsxBuf.length + Buffer.byteLength(extendText);
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

  // Step 2: 流式压缩最终导出包。
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

  // store 模式：点云和压缩收益极低的配置文件仅归档不压缩。
  const archive = new ZipArchive({ zlib: { level: 0 } });
  archive.pipe(progressStream).pipe(output);

  appendMapContents(archive, src, mapName, pointTableData);
  archive.append(xlsxBuf, { name: "point.xlsx" });
  archive.append(extendText, { name: "extend.json" });

  await Promise.all([
    archive.finalize(),
    new Promise<void>((resolve, reject) => {
      output.on("close", resolve);
      output.on("error", reject);
      (archive as any).on("error", reject);
    }),
  ]);

  onProgress?.("完成", 100);
  return { zipPath, zipName: path.basename(zipPath, ".zip") };
}
