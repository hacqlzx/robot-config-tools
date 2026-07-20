export interface CabinetPointRow {
  key: string;
  index: number;
  name: string;
  type?: string;
  confidence?: number;
  source?: "ocr" | "single";
  boundRectId?: string;
  boundRectTool?: AnnotationTool;
}

export interface CabinetTreeNode {
  key: string;
  title: string;
  nodeType: "station" | "bay" | "main" | "component";
  children?: CabinetTreeNode[];
  isLeaf?: boolean;
}

export type AnnotationTool = "standardPart" | "deviceLabel" | "deviceBox" | "appearance";
export type CabinetOcrScope = "whole" | "deviceLabels" | "selected";

export interface AnnotationSelection {
  tool: AnnotationTool;
  id: string;
}

export interface ImageRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  confidence?: number;
  source?: "manual" | "mock" | "ocr";
  saved?: boolean;
  generationStatus?: "pending" | "generated" | "saved";
  groupId?: string;
  generatedFromRectId?: string;
}

export interface ComponentAnnotations {
  standardPartRects: ImageRect[];
  deviceLabelRects: ImageRect[];
  deviceBoxRects: ImageRect[];
  appearanceRects: ImageRect[];
}

export interface AnnotationHistoryEntry {
  componentCode: string;
  annotations: ComponentAnnotations;
  ocrRows?: CabinetPointRow[];
  singlePoints?: CabinetSinglePoint[];
}

export interface CabinetSinglePoint {
  id: string;
  componentCode: string;
  pointName: string;
  recognitionType: string;
  boundRectId: string;
  boundRectTool: AnnotationTool;
  rectSnapshot: ImageRect;
  createdAt: string;
  saved: boolean;
}

export interface SinglePointDraft {
  pointName: string;
  recognitionType: string;
}
