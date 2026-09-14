import http from "@/services/http";

let surveyRunningEndpoint = "/robot/tool/task/survey/getSurveyRunning";

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
export function setCurrentMap(params) {
  return http.get("/robot/tool/robotMap/setCurrentMap", params);
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
 * @param {File} file - 点表 ZIP 文件包
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

/** 空间模型导入（文件上传） */
export function importSpaceModel(file, robotId) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("robotId", String(robotId));
  return http.post("/robot/tool/file/importSpaceModel", formData);
}

/** 工程备份导入（文件上传） */
export function importBack(file, robotId, type) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("robotId", String(robotId));
  formData.append("type", String(type));
  return http.post("/robot/tool/file/importBack", formData);
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

/** 纠偏数据导入（文件上传） */
export function importCorrection(file, robotId) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("robotId", String(robotId));
  return http.post("/robot/tool/file/importCorrection", formData);
}

/** 屏柜标注参数导入（文件上传） */
export function importScreenVerifyAnnotationParams(file) {
  const formData = new FormData();
  formData.append("file", file);
  return http.post("/robot/tool/file/syncModelJSON", formData);
}

/** 恢复后台数据库 */
export function databaseRestore(file) {
  const formData = new FormData();
  formData.append("file", file);
  return http.post("/robot/tool/file/databaseRestore", formData);
}

/** 后台程序升级 */
export function backstageProgramUpgrade(file) {
  const formData = new FormData();
  formData.append("file", file);
  return http.post("/robot/tool/file/backstageProgramUpgrade", formData);
}

/** 机器人程序升级 */
export function robotProgramUpgrade(file, robotId) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("robotId", String(robotId));
  return http.post("/robot/tool/file/robotProgramUpgrade", formData);
}

// ========== 任务下发 ==========

/**
 * 设备区勘察图拍照
 * @param {number} robotId - 机器人 ID
 * @param {string[]} deviceList - 设备区 ID 列表，对应空间模型 description_file.json 的设备区 id
 */
export function equipmentDeviceMainCollect(robotId, deviceList) {
  return http.post("/robot/tool/task/equipmentDeviceMainCollect", {
    robotId,
    deviceList,
  });
}

/**
 * 设备区补充勘察图拍照
 * @param {number} robotId - 机器人 ID
 * @param {string[]} stopPointIdList - 停靠点 ID 列表
 */
export function stopPointCollect(robotId, stopPointIdList) {
  return http.post("/robot/tool/task/stopPointCollect", {
    robotId,
    stopPointIdList,
  });
}

/**
 * 查询勘察任务执行状态
 * @param {number} robotId - 机器人 ID
 */
export async function getSurveyRunning(robotId) {
  try {
    return await http.get(surveyRunningEndpoint, { robotId });
  } catch (e) {
    // 兼容不同后台版本：旧版使用 /survey/check，新版使用 /survey/getSurveyRunning。
    // 一旦 fallback 成功，后续查询固定使用成功的路径，减少重复失败请求。
    if (surveyRunningEndpoint !== "/robot/tool/task/survey/check") {
      const res = await http.get("/robot/tool/task/survey/check", { robotId });
      surveyRunningEndpoint = "/robot/tool/task/survey/check";
      return res;
    }
    throw e;
  }
}

/**
 * 屏柜区屏柜拍照
 * @param {number} robotId - 机器人 ID
 * @param {string[]} deviceList - 当前地图 description_file.json 中的屏柜 ID 列表
 */
export function cabinetDeviceMainCollect(robotId, deviceList) {
  return http.post("/robot/tool/task/cabinetDeviceMainCollect", {
    robotId,
    deviceList,
  });
}

/**
 * 下发巡视任务
 * @param {number} robotId - 机器人 ID
 * @param {{ pointCodeList?: string[], bayCodeList?: string[] }} data - 点位编码或间隔编码，二选一
 */
export function startTask(robotId, data) {
  return http.post("/robot/tool/task/startTask", {
    robotId,
    ...data,
  });
}

// ========== 实时监控 ==========

/** 按厂站获取机器人及摄像头信息 */
export function queryCameraListByFacId(params) {
  return http.get("/robot/cameraInfo/queryCameraListByFacId", params);
}

/** 获取机器人厂站地图 */
export function findFacMap(params) {
  return http.get("/robot/facInfo/getFacMap", params);
}

/** 根据地图编码获取机器人区域 */
export function getRobotRegionByMapCode(params) {
  return http.get("/robot/robot/getRobotRegionByMapCode", params);
}

/** 获取机器人路径 */
export function getRobotRoad(params) {
  return http.get("/robot/robot/getRobotRoad", params);
}

/** 获取机器人停靠点 */
export function getRobotStopNode(params) {
  return http.get("/robot/robot/getRobotStopNode", params);
}

/** 查询机器人当前实时任务 */
export function queryRunningListV2(params) {
  return http.get("/robot/taskPatrolled/robotMonitor/queryRunningListV2", params);
}

/** 暂停任务 */
export function pauseRealtimeTask(params) {
  return http.get("/robot/taskPatrolled/robotMonitor/pause", params);
}

/** 继续任务 */
export function resumeRealtimeTask(params) {
  return http.get("/robot/taskPatrolled/robotMonitor/resume", params);
}

/** 终止任务 */
export function terminateRealtimeTask(params) {
  return http.get("/robot/taskPatrolled/robotMonitor/terminate", params);
}

/** 获取机器人位置指标 */
export function getRobotIndexData(params) {
  return http.get("/robot/robotData/getRobotIndexData", params);
}

/** 获取机器人运行数据 */
export function getRobotRunData(params) {
  return http.get("/robot/robotData/getRobotRunData", params);
}

/** 获取机器人状态数据 */
export function getRobotStatusData(params) {
  return http.get("/robot/robotData/getRobotStatusData", params);
}

/** 获取机器人状态面板 */
export function getRobotStatusPanel(params) {
  return http.get("/robot/tool/panel/getAll", params);
}

/** 获取机器人辅助状态 */
export function getRobotSupState(params) {
  return http.get("/robot/robot/getRobotSupState", params);
}

/** 注册机器人摄像头 WebRTC 视频流 */
export function registerCameraWebRtcSrs(params) {
  return http.get("/robot/videoOperate/registerCameraWebRtcSrs", params);
}

/** 下发机器人车体/模式控制 */
export function robotControlToRobotHost(data) {
  return http.post("/robot/robotControl/bodyControl", data);
}

/** 导出指定时间范围的机器人日志小包 */
export function getRobotLog(params) {
  return http.get("/robot/tool/file/getRobotLog", params);
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

/** 屏柜验证图导出 */
export function exportDeviceImage(robotId) {
  return http.get("/robot/tool/file/exportDeviceImage", { robotId });
}

/** 设备验证图导出 */
export function exportDeviceCheckImage(robotId) {
  return http.get("/robot/tool/file/exportDeviceCheckImage", { robotId });
}

/** 工程备份导出 */
export function exportBack(robotId) {
  return http.get("/robot/tool/file/exportBack", { robotId });
}

/** 备份后台数据库 */
export function databaseBackup() {
  return http.get("/robot/tool/file/databaseBackup");
}

/** 导出后台运行日志 */
export function exportBackendLog() {
  return http.get("/robot/tool/file/exportBackendLog");
}

/** 导出机器人最近一个月运行日志 */
export function getRecentMonthRobotLog(robotId) {
  return http.get("/robot/tool/file/getRecentMonthRobotLog", { robotId });
}

/** 点表模板下载 */
export function downLoadExcelTemplate() {
  return http.get("/robot/tool/file/downLoadExcelTemplate");
}

/** 通信信息模板下载 */
export function downloadCommunicateExcel() {
  return http.get("/robot/tool/file/downloadCommunicateExcel");
}
