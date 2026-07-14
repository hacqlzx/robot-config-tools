/**
 * 绘制数据的 LAS 绝对坐标与 PlayCanvas 场景坐标转换。
 *
 * 点云加载时会采用 floating-origin：场景中的点以 LAS 包围盒中心为原点，数值较小；
 * 文件协议则必须保存原始 LAS 坐标，才能与机器人及其他地图工具对齐。这里集中处理
 * 两套坐标系的往返转换，调用方无需了解点云加载器选择的偏移量。
 *
 * 转换只改变坐标，不改变点/路径 id、数组顺序或拓扑关系。
 */

import type { LasCoordinateTransform, Vec3Tuple } from "../../utils/las-coordinate-transform";
import type { PathData } from "./drawing-schema";

/** 将宽松的顶点数组收窄为三维元组；协议中的无效顶点不会进入后续几何计算。 */
export function toTuple(value: number[]): Vec3Tuple | null {
  const [x, y, z] = value;
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? [x, y, z] : null;
}

function mapVerts(verts: number[][], transform: (point: Vec3Tuple) => Vec3Tuple): number[][] {
  // 外部 JSON 可能包含缺维或非有限数值。过滤坏点可避免 NaN 扩散到渲染和保存结果。
  return verts
    .map(toTuple)
    .filter((point): point is Vec3Tuple => point !== null)
    .map((point) => [...transform(point)]);
}

export function sceneVertsToLas(verts: number[][], coordinate: LasCoordinateTransform): number[][] {
  return mapVerts(verts, coordinate.sceneToLas);
}

export function lasVertsToScene(verts: number[][], coordinate: LasCoordinateTransform): number[][] {
  return mapVerts(verts, coordinate.lasToScene);
}

export function scenePathDataToLas(data: PathData, coordinate: LasCoordinateTransform): PathData {
  return {
    points: data.points.map((point) => {
      const [x, y, z] = coordinate.sceneToLas([point.x, point.y, point.z]);
      return { ...point, x, y, z };
    }),
    paths: data.paths.map((path) => ({
      ...path,
      // 控制点与端点位于同一坐标系；遗漏它们会导致重载后的曲线形状整体偏移。
      bezier: path.bezier ? {
        cp1: coordinate.sceneToLas(path.bezier.cp1),
        cp2: coordinate.sceneToLas(path.bezier.cp2),
      } : null,
    })),
  };
}

export function lasPathDataToScene(data: PathData, coordinate: LasCoordinateTransform): PathData {
  return {
    points: data.points.map((point) => {
      const [x, y, z] = coordinate.lasToScene([point.x, point.y, point.z]);
      return { ...point, x, y, z };
    }),
    paths: data.paths.map((path) => ({
      ...path,
      // 贝塞尔控制点也必须减去 floating-origin，才能与场景中的端点保持相对位置。
      bezier: path.bezier ? {
        cp1: coordinate.lasToScene(path.bezier.cp1),
        cp2: coordinate.lasToScene(path.bezier.cp2),
      } : null,
    })),
  };
}
