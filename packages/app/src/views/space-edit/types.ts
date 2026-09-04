export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "failed";

export type ViewDirection = "前" | "后" | "左" | "右" | "上" | "下";

export interface SpaceTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: SpaceTreeNode[];
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
