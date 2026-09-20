export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "failed";

export type ViewDirection = "前" | "后" | "左" | "右" | "上" | "下";

export interface SpaceTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: SpaceTreeNode[];
  virtualType?: "inspection-root" | "inspection-bay" | "inspection-point";
  inspectionPointId?: string;
  inspectionBayKey?: string;
  inspectionMapActive?: boolean;
  /** 巡检点绑定异常；存在时树节点保持红色，直至数据修正。 */
  inspectionIssueMessage?: string;
  mapContentActive?: boolean;
}

export interface ModelPointStats {
  total: number;
  loaded: number;
}

export interface ModelCenter {
  x: number;
  y: number;
  z: number;
}

export interface SpaceMessageApi {
  success: (msg: string) => void;
  warning: (msg: string) => void;
  error: (msg: string) => void;
}
