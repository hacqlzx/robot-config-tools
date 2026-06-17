import http from "@/services/http";

// ========== 厂站 ==========

/** 获取全部厂站 */
export function getAllFac() {
  return http.get("/robot/tool/getAllFac");
}

/** ???????? ID??????????????? */
export function getFacInfo() {
  return http.get("/robot/tool/facInfo/get");
}

// ========== 示例 ==========

/**
 * GET 携带 query 参数
 * getAllFac({ stationName: "xxx", page: 1 })
 */
// export function getAllFac(params) {
//   return http.get("/robot/tool/getAllFac", params);
// }

/**
 * POST 携带 body 参数
 * createFac({ stationName: "xxx", stationCode: "001" })
 */
// export function createFac(data) {
//   return http.post("/robot/tool/createFac", data);
// }
