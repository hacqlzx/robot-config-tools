import type { Key } from "react";
import type { CabinetTreeNode } from "../types";

export function buildCabinetTree(
  records: CabinetImagePackageRecord[],
  filterText: string,
  pointCounts: Record<string, number> = {},
): { treeData: CabinetTreeNode[]; allExpandableKeys: Key[] } {
  const filter = filterText.trim();
  const stationMap = new Map<string, CabinetTreeNode>();
  const allExpandableKeys: Key[] = [];

  for (const record of records) {
    if (filter && ![
      record.robotCode,
      record.stationName,
      record.areaName,
      record.bayName,
      record.mainDeviceName,
      record.componentName,
      record.componentCode,
    ].some((value) => value.includes(filter))) {
      continue;
    }

    const recordKey = getCabinetRecordKey(record);
    const stationKey = buildStationKey(record);
    const areaKey = buildAreaKey(record);
    const bayKey = buildBayKey(record);
    const mainKey = buildMainDeviceKey(record);
    const componentKey = `component:${recordKey}`;
    const pointCount = pointCounts[recordKey] || 0;

    const stationNode = ensureNode(stationMap, stationKey, record.stationName || record.stationCode || "未命名厂站", "station");
    const areaNode = ensureChildNode(stationNode, areaKey, record.areaName || record.areaCode || "未命名区域", "area");
    const bayNode = ensureChildNode(areaNode, bayKey, record.bayName || record.bayCode || "未命名间隔", "bay");
    const mainNode = ensureChildNode(bayNode, mainKey, record.mainDeviceName || record.mainDeviceCode || "未命名主设备", "main");
    const existingComponent = mainNode.children?.find((item) => item.key === componentKey);
    if (existingComponent) {
      existingComponent.pointCount = pointCount;
    } else {
      mainNode.children = mainNode.children || [];
      mainNode.children.push({
        key: componentKey,
        title: record.componentName || record.componentCode,
        nodeType: "component",
        pointCount,
        isLeaf: true,
      });
    }
  }

  const treeData = [...stationMap.values()];
  fillTreePointCounts(treeData);
  collectExpandableKeys(treeData, allExpandableKeys);
  return { treeData, allExpandableKeys };
}

export function buildMainDeviceKey(record: CabinetImagePackageRecord): string {
  return `${buildBayKey(record)}/main:${record.mainDeviceCode || record.mainDeviceName || "default"}`;
}

export function buildInitialExpandedKeys(records: CabinetImagePackageRecord[]): Key[] {
  return buildCabinetTree(records, "").allExpandableKeys;
}

export function getCabinetRecordKey(record: CabinetImagePackageRecord): string {
  return record.recordKey || `${record.robotCode || "default"}::${record.componentCode}`;
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
