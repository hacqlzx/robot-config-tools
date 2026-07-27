import type { ComponentAnnotations, ImageRect } from "../types";

export interface AnnotationGroup {
  id: string;
  standardPartRect: ImageRect;
  labelRects: ImageRect[];
  deviceRects: ImageRect[];
  status: "pending" | "generated" | "saved";
}

export interface AnnotationGroupValidationResult {
  groups: AnnotationGroup[];
  issues: string[];
}

interface ValidateAnnotationGroupsOptions {
  targetLabelIds: Set<string>;
  requiredStandardPartIds?: Set<string>;
}

export function validateAnnotationGroups(
  annotations: ComponentAnnotations,
  options: ValidateAnnotationGroupsOptions,
): AnnotationGroupValidationResult {
  const standardPartRects = annotations.standardPartRects || [];
  const targetLabels = (annotations.deviceLabelRects || []).filter((rect) => options.targetLabelIds.has(rect.id));
  const issues: string[] = [];

  if (!standardPartRects.length) issues.push("请先框选标准部件框");
  if (!targetLabels.length) issues.push("没有需要生成的未保存标签框");

  const labelsByGroup = new Map<string, ImageRect[]>();
  for (const label of targetLabels) {
    const containers = standardPartRects.filter((standardPart) => containsRect(standardPart, label));
    if (!containers.length) {
      issues.push(`标签框 ${formatRect(label)} 不在任何标准部件框内`);
      continue;
    }
    if (containers.length > 1) {
      issues.push(`标签框 ${formatRect(label)} 同时属于多个标准部件框`);
      continue;
    }
    const groupId = containers[0].id;
    labelsByGroup.set(groupId, [...(labelsByGroup.get(groupId) || []), label]);
  }

  for (const standardPartId of options.requiredStandardPartIds || []) {
    if (!(labelsByGroup.get(standardPartId) || []).length) {
      issues.push("新框选的标准部件框内至少需要一个未保存标签框");
    }
  }

  const groups = standardPartRects
    .filter((standardPart) => (labelsByGroup.get(standardPart.id) || []).length > 0)
    .map((standardPart) => {
      const labelRects = sortRects(labelsByGroup.get(standardPart.id) || []);
      const deviceRects = sortRects((annotations.deviceBoxRects || []).filter((rect) => rect.groupId === standardPart.id));
      return {
        id: standardPart.id,
        standardPartRect: standardPart,
        labelRects,
        deviceRects,
        status: getGroupStatus(standardPart, labelRects, deviceRects),
      } satisfies AnnotationGroup;
    });

  return { groups: sortGroups(groups), issues: unique(issues) };
}

export function sortGroups(groups: AnnotationGroup[]): AnnotationGroup[] {
  return [...groups].sort((left, right) => (
    left.standardPartRect.y - right.standardPartRect.y
    || left.standardPartRect.x - right.standardPartRect.x
  ));
}

function getGroupStatus(standardPart: ImageRect, labels: ImageRect[], devices: ImageRect[]): AnnotationGroup["status"] {
  const rects = [standardPart, ...labels, ...devices];
  if (rects.length > 1 && rects.every((rect) => rect.saved || rect.generationStatus === "saved")) return "saved";
  if (devices.length || labels.some((rect) => rect.source === "mock" || rect.source === "ocr" || rect.source === "ai")) return "generated";
  return "pending";
}

function containsRect(outer: ImageRect, inner: ImageRect): boolean {
  const tolerance = 0.5;
  return inner.x >= outer.x - tolerance
    && inner.y >= outer.y - tolerance
    && inner.x + inner.w <= outer.x + outer.w + tolerance
    && inner.y + inner.h <= outer.y + outer.h + tolerance;
}

function sortRects(rects: ImageRect[]): ImageRect[] {
  return [...rects].sort((left, right) => left.y - right.y || left.x - right.x);
}

function formatRect(rect: ImageRect): string {
  return `(${Math.round(rect.x)}, ${Math.round(rect.y)})`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
