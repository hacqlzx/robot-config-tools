import http from "@/services/http";

// ========== 厂站 ==========

/** 获取全部厂站 */
export function getAllFac() {
  return http.get("/robot/tool/getAllFac");
}

/** 厂站查询 */
export function getFacInfo() {
  return http.get("/robot/tool/facInfo/get");
}

/** 厂站新增 */
export function addFac(data) {
  return http.post("/robot/tool/facInfo/add", data);
}

/** 厂站更新 */
export function editFac(data) {
  return http.post("/robot/tool/facInfo/edit", data);
}

/** 厂站删除 */
export function deleteFac(id) {
  return http.post("/robot/tool/facInfo/delete", { id });
}

/** 厂站切换默认厂站 */
export function setCurrentFac(id) {
  return http.post("/robot/tool/facInfo/setCurrentFac", { id });
}

// ========== 机器人 ==========

/** 机器人查询 */
export function getAllRobot() {
  return http.get("/robot/tool/robot/getAllRobot");
}

/** 机器人新增 */
export function addRobot(data) {
  return http.post("/robot/tool/robot/add", data);
}

/** 机器人更新 */
export function updateRobot(data) {
  return http.post("/robot/tool/robot/update", data);
}

/** 机器人删除 */
export function deleteRobot(id) {
  return http.get("/robot/tool/robot/delete", { id });
}

// ========== 地图 ==========

/** 地图查询 */
export function getMapList() {
  return http.get("/robot/tool/robotMap/get");
}

/** 地图修改 */
export function editMap(data) {
  return http.post("/robot/tool/robotMap/edit", data);
}

/** 地图删除 */
export function deleteMap(id) {
  return http.get("/robot/tool/robotMap/delete", { id });
}

/** 地图切换运行 */
export function setCurrentMap(id) {
  return http.get("/robot/tool/robotMap/setCurrentMap", { id });
}

// ========== 后台 ==========

/** 后台查询 */
export function getRobotInfo() {
  return http.get("/robot/tool/robotHost/get");
}

/** 后台保存 */
export function saveRobotInfo(data) {
  return http.post("/robot/tool/robotHost/saveOrEdit", data);
}

// ========== 智能分析服务 ==========

/** 分析主机查询 */
export function getAnalysisMachineInfo() {
  return http.get("/robot/tool/analysisMachineInfo/get");
}

/** 分析主机保存 */
export function saveAnalysisMachineInfo(data) {
  return http.post("/robot/tool/analysisMachineInfo/save", data);
}

// ========== 上级主机 ==========

/** 上级主机查询 */
export function getSuperSystemInfo() {
  return http.get("/robot/tool/superSystemInfo/get");
}

/** 上级主机保存 */
export function saveSuperSystemInfo(data) {
  return http.post("/robot/tool/superSystemInfo/save", data);
}

// ========== 网络 ==========

/** 网络查询 */
export function getNetworkList() {
  return http.get("/robot/tool/network/get");
}

/** 网络修改 */
export function editNetwork(data) {
  return http.post("/robot/tool/network/edit", data);
}

// ========== 导入 ==========

/**
 * 点表导入（文件上传）
 * @param {File} file - Excel 文件
 * @param {number} robotId - 机器人 ID
 * @param {number} stationId - 厂站 ID
 */
export function importDevicePoint(file, robotId, stationId) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("robotId", String(robotId));
  formData.append("stationId", String(stationId));
  return http.post("/robot/tool/file/importDevicePoint", formData);
}

/**
 * 通信信息导入（文件上传）
 * @param {File} file - Excel 文件
 */
export function importCommunicateExcel(file) {
  const formData = new FormData();
  formData.append("file", file);
  return http.post("/robot/tool/file/importCommunicateExcel", formData);
}

/**
 * 图像标识导入（文件上传）
 * @param {File} file - 图像标识 zip 文件
 * @param {number} robotId - 机器人 ID
 */
export function importProspectCalibration(file, robotId) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("robotId", String(robotId));
  return http.post("/robot/tool/file/importProspectCalibration", formData);
}

// ========== 导出 ==========

/**
 * 空间模型导出
 * @param {number} robotId - 机器人 ID
 * @returns 返回 { data: "/robot/robot/..." } 文件路径
 */
export function exportSpaceModel(robotId) {
  return http.get("/robot/tool/file/exportSpaceModel", { robotId });
}

/**
 * 勘察图像导出
 * @param {number} robotId - 机器人 ID
 * @returns 返回 { data: "/robot/robot/..." } 文件路径
 */
export function exportProspectImage(robotId) {
  return http.get("/robot/tool/file/exportProspectImage", { robotId });
}

/**
 * 设备验证图导出
 * @param {number} robotId - 机器人 ID
 * @returns 返回 { data: "/robot/robot/..." } 文件路径
 */
export function exportDeviceCheckImage(robotId) {
  return http.get("/robot/tool/file/exportDeviceCheckImage", { robotId });
}

/** 点表模板下载 */
export function downLoadExcelTemplate() {
  return http.get("/robot/tool/file/downLoadExcelTemplate");
}

/** 通信信息模板下载 */
export function downloadCommunicateExcel() {
  return http.get("/robot/tool/file/downloadCommunicateExcel");
}
