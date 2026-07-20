import type { Key } from "react";
import type { CabinetTreeNode } from "../types";

export function buildCabinetTree(records: CabinetImagePackageRecord[], filterText: string): { treeData: CabinetTreeNode[]; allExpandableKeys: Key[] } {
  const filter = filterText.trim();
  const stationMap = new Map<string, CabinetTreeNode>();
  const allExpandableKeys: Key[] = [];

  for (const record of records) {
    if (filter && ![
      record.stationName,
      record.bayName,
      record.mainDeviceName,
      record.componentName,
      record.componentCode,
    ].some((value) => value.includes(filter))) {
      continue;
    }

    const stationKey = buildStationKey(record);
    const bayKey = buildBayKey(record);
    const mainKey = buildMainDeviceKey(record);
    const componentKey = `component:${record.componentCode}`;

    const stationNode = ensureNode(stationMap, stationKey, record.stationName || record.stationCode || "未命名厂站", "station");
    const bayNode = ensureChildNode(stationNode, bayKey, record.bayName || record.bayCode || "未命名间隔", "bay");
    const mainNode = ensureChildNode(bayNode, mainKey, record.mainDeviceName || record.mainDeviceCode || "未命名主设备", "main");
    if (!mainNode.children?.some((item) => item.key === componentKey)) {
      mainNode.children = mainNode.children || [];
      mainNode.children.push({
        key: componentKey,
        title: record.componentName || record.componentCode,
        nodeType: "component",
        isLeaf: true,
      });
    }
  }

  const treeData = [...stationMap.values()];
  collectExpandableKeys(treeData, allExpandableKeys);
  return { treeData, allExpandableKeys };
}

export function buildMainDeviceKey(record: CabinetImagePackageRecord): string {
  return `${buildBayKey(record)}/main:${record.mainDeviceCode || record.mainDeviceName || "default"}`;
}

export function buildInitialExpandedKeys(records: CabinetImagePackageRecord[]): Key[] {
  return buildCabinetTree(records, "").allExpandableKeys;
}

function buildStationKey(record: CabinetImagePackageRecord): string {
  return `station:${record.stationCode || record.stationName || "default"}`;
}

function buildBayKey(record: CabinetImagePackageRecord): string {
  return `${buildStationKey(record)}/bay:${record.bayCode || record.bayName || "default"}`;
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

function collectExpandableKeys(nodes: CabinetTreeNode[], out: Key[]) {
  for (const node of nodes) {
    if (node.children?.length) {
      out.push(node.key);
      collectExpandableKeys(node.children, out);
    }
  }
}
