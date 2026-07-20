import type { AnnotationGroup } from "../utils/annotation-group-utils";

export interface DlBoundingRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DlPoint {
  x: number;
  y: number;
}

export interface DlResult {
  classid: string;
  score: number;
  rect: DlBoundingRect;
  mask: { points: DlPoint[] };
}

export interface MockDeviceDetection {
  groupId: string;
  sourceLabelRectId: string;
  result: DlResult;
}

export interface MockDeviceDetectionResponse {
  detections: MockDeviceDetection[];
  issues: string[];
}

const DEVICE_LABEL_GAP = 10;

export function mockDetectDevices(groups: AnnotationGroup[]): MockDeviceDetectionResponse {
  const detections: MockDeviceDetection[] = [];

  for (const group of groups) {
    for (const label of group.labelRects) {
      const side = Math.max(1, Math.round(label.w));
      const rect: DlBoundingRect = {
        x: Math.round(label.x),
        y: Math.round(label.y + label.h + DEVICE_LABEL_GAP),
        w: side,
        h: side,
      };
      detections.push({
        groupId: group.id,
        sourceLabelRectId: label.id,
        result: {
          classid: "mock_device",
          score: 1,
          rect,
          mask: { points: [] },
        },
      });
    }
  }

  return { detections, issues: [] };
}
