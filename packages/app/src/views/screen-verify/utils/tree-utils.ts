import type { Key } from "react";
import type { CabinetTreeNode } from "../types";

/**
 * 构建屏柜图像左侧树。
 * 默认展示厂站、区域、间隔、屏柜、部件完整层级；搜索或状态筛选时压缩为屏柜和部件两层。
 */
export function buildCabinetTree(
  records: CabinetImagePackageRecord[],
  filterText: string,
  pointCounts: Record<string, number> = {},
  markedComponents: Record<string, boolean> = {},
  statusFilter: "marked" | "unmarked" | "all" = "all",
): { treeData: CabinetTreeNode[]; allExpandableKeys: Key[] } {
  const filter = filterText.trim();
  const compactTree = Boolean(filter) || statusFilter !== "all";
  const rootMap = new Map<string, CabinetTreeNode>();
  const allExpandableKeys: Key[] = [];

  for (const record of records) {
    const recordKey = getCabinetRecordKey(record);
    const marked = Boolean(markedComponents[recordKey] || pointCounts[recordKey]);
    if (statusFilter === "marked" && !marked) continue;
    if (statusFilter === "unmarked" && marked) continue;

    const mainTitle = record.mainDeviceName || record.mainDeviceCode || "未命名屏柜";
    const componentTitle = record.componentName || record.componentCode || record.imageName || "未命名主设备";
    if (filter && !record.mainDeviceName.includes(filter)) {
      continue;
    }

    const stationKey = buildStationKey(record);
    const areaKey = buildAreaKey(record);
    const bayKey = buildBayKey(record);
    const mainKey = buildMainDeviceKey(record);
    const componentKey = `component:${recordKey}`;
    const pointCount = pointCounts[recordKey] || 0;

    const mainNode = compactTree
      ? ensureNode(rootMap, mainKey, mainTitle, "main")
      : ensureChildNode(
        ensureChildNode(
          ensureChildNode(
            ensureNode(rootMap, stationKey, record.stationName || record.stationCode || "未命名厂站", "station"),
            areaKey,
            record.areaName || record.areaCode || "未命名区域",
            "area",
          ),
          bayKey,
          record.bayName || record.bayCode || "未命名间隔",
          "bay",
        ),
        mainKey,
        mainTitle,
        "main",
      );
    const existingComponent = mainNode.children?.find((item) => item.key === componentKey);
    if (existingComponent) {
      existingComponent.pointCount = pointCount;
    } else {
      mainNode.children = mainNode.children || [];
      mainNode.children.push({
        key: componentKey,
        title: componentTitle,
        nodeType: "component",
        pointCount,
        isLeaf: true,
      });
    }
  }

  const treeData = [...rootMap.values()];
  fillTreePointCounts(treeData);
  collectExpandableKeys(treeData, allExpandableKeys);
  return { treeData, allExpandableKeys };
}

/**
 * 主设备节点 key 必须稳定，否则 OCR 修改主设备名称后会导致树节点丢失展开状态。
 */
export function buildMainDeviceKey(record: CabinetImagePackageRecord): string {
  return `${buildBayKey(record)}/main:${record.mainDeviceCode || record.mainDeviceName || "default"}`;
}

/**
 * 主设备名称覆盖使用机器人和设备层级联合定位，不直接依赖显示名称。
 */
export function buildMainDeviceOverrideKey(record: CabinetImagePackageRecord): string {
  return [
    record.robotCode || "default",
    record.stationCode || record.stationName || "default",
    record.areaCode || record.areaName || "default",
    record.bayCode || record.bayName || "default",
    record.mainDeviceCode || record.componentCode || record.mainDeviceName || "default",
  ].join("::");
}

export function buildInitialExpandedKeys(records: CabinetImagePackageRecord[]): Key[] {
  return buildCabinetTree(records, "").allExpandableKeys;
}

export function getCabinetRecordKey(record: CabinetImagePackageRecord): string {
  return record.recordKey || [
    record.robotCode || "default",
    record.stationCode || record.stationName || "default",
    record.areaCode || record.areaName || "default",
    record.bayCode || record.bayName || "default",
    record.mainDeviceCode || "default",
    record.componentCode || "default",
    record.calibrationId || record.imageName || "default",
  ].join("::");
}

function buildStationKey(record: CabinetImagePackageRecord): string {
  return `station:${record.stationCode || record.stationName || "default"}`;
}

function buildAreaKey(record: CabinetImagePackageRecord): string {
  return `${buildStationKey(record)}/area:${record.areaCode || record.areaName || "default"}`;
}

function buildBayKey(record: CabinetImagePackageRecord): string {
  return `${buildAreaKey(record)}/bay:${record.bayCode || record.bayName || "default"}`;
}

function ensureNode(map: Map<string, CabinetTreeNode>, key: string, title: string, nodeType: CabinetTreeNode["nodeType"]): CabinetTreeNode {
  let node = map.get(key);
  if (!node) {
    node = { key, title, nodeType, children: [] };
    map.set(key, node);
  }
  return node;
}

function ensureChildNode(parent: CabinetTreeNode, key: string, title: string, nodeType: CabinetTreeNode["nodeType"]): CabinetTreeNode {
  parent.children = parent.children || [];
  let node = parent.children.find((item) => item.key === key);
  if (!node) {
    node = { key, title, nodeType, children: [] };
    parent.children.push(node);
  }
  return node;
}

/**
 * 从叶子部件向上汇总点位数，供后续已标注/未标注状态判断使用。
 */
function fillTreePointCounts(nodes: CabinetTreeNode[]): number {
  let total = 0;
  for (const node of nodes) {
    if (node.children?.length) {
      node.pointCount = fillTreePointCounts(node.children);
    }
    total += node.pointCount || 0;
  }
  return total;
}

function collectExpandableKeys(nodes: CabinetTreeNode[], out: Key[]) {
  for (const node of nodes) {
    if (node.children?.length) {
      out.push(node.key);
      collectExpandableKeys(node.children, out);
    }
  }
}
