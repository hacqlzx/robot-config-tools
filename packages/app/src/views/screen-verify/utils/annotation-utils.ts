import type { AnnotationSelection, AnnotationTool, ComponentAnnotations, ImageRect } from "../types";

export function createEmptyAnnotations(): ComponentAnnotations {
  return {
    standardPartRects: [],
    deviceLabelRects: [],
    deviceBoxRects: [],
    appearanceRects: [],
  };
}

export function cloneAnnotations(annotations: ComponentAnnotations): ComponentAnnotations {
  return {
    standardPartRects: (annotations.standardPartRects || []).map((rect) => ({ ...rect })),
    deviceLabelRects: (annotations.deviceLabelRects || []).map((rect) => ({ ...rect })),
    deviceBoxRects: (annotations.deviceBoxRects || []).map((rect) => ({ ...rect })),
    appearanceRects: (annotations.appearanceRects || []).map((rect) => ({ ...rect })),
  };
}

export function annotationToolKey(tool: AnnotationTool): keyof ComponentAnnotations {
  if (tool === "standardPart") return "standardPartRects";
  if (tool === "deviceBox") return "deviceBoxRects";
  if (tool === "appearance") return "appearanceRects";
  return "deviceLabelRects";
}

export function findSelectedAnnotation(annotations: ComponentAnnotations, selection: AnnotationSelection): ImageRect | null {
  const rects = annotations[annotationToolKey(selection.tool)];
  return rects.find((rect) => rect.id === selection.id) || null;
}
