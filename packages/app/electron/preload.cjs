const { contextBridge, ipcRenderer, webUtils } = require("electron");

// Helper: invoke a db channel and unwrap {ok, data/error}
function dbInvoke(repo, method) {
  return (...args) =>
    ipcRenderer.invoke(`db:${repo}:${method}`, ...args).then((res) => {
      if (!res.ok) throw new Error(res.error);
      return res.data;
    });
}

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  minimize: () => ipcRenderer.send("win:minimize"),
  maximize: () => ipcRenderer.send("win:maximize"),
  getWindowState: () => ipcRenderer.invoke("win:get-state"),
  onWindowStateChange: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("win:state", handler);
    return () => ipcRenderer.removeListener("win:state", handler);
  },
  close: () => ipcRenderer.send("win:close"),
  ping: (ip) => ipcRenderer.invoke("ping", ip),
  getFilePath: (file) => webUtils.getPathForFile(file),
  readFileChunk: (path, offset, length) =>
    ipcRenderer.invoke("read-file-chunk", path, offset, length),
  readLargeFile: (path) => ipcRenderer.invoke("read-large-file", path),
  // GPU 信息诊断：帮助排查核显/独显导致颜色渲染异常的问题
  getGPUInfo: () => ipcRenderer.invoke("gpu:info"),
  project: {
    list: () => ipcRenderer.invoke("project:list"),
    create: (name) => ipcRenderer.invoke("project:create", name),
    rename: (oldName, newName) =>
      ipcRenderer.invoke("project:rename", oldName, newName),
    delete: (name) => ipcRenderer.invoke("project:delete", name),
    getDataSummary: (name) => ipcRenderer.invoke("project:data-summary", name),
    importFile: (projectName, sourcePath, fileName) =>
      ipcRenderer.invoke("project:import-file", projectName, sourcePath, fileName),
    importModelZip: (projectName, sourcePath) =>
      ipcRenderer.invoke("project:import-model-zip", projectName, sourcePath),
    inspectModelZipImport: (projectName, sourcePath) =>
      ipcRenderer.invoke("project:inspect-model-zip-import", projectName, sourcePath),
    getManifest: (projectName) =>
      ipcRenderer.invoke("project:get-manifest", projectName),
    listTree: (projectName, subDir) =>
      ipcRenderer.invoke("project:list-tree", projectName, subDir),
    writeFile: (projectName, subPath, data) =>
      ipcRenderer.invoke("project:write-file", projectName, subPath, data),
    deletePath: (targetPath) =>
      ipcRenderer.invoke("project:delete-path", targetPath),
    renamePath: (targetPath, newName) =>
      ipcRenderer.invoke("project:rename-path", targetPath, newName),
    openDir: (targetPath) =>
      ipcRenderer.invoke("project:open-dir", targetPath),
    exportFile: (projectName, subPath, destDir) =>
      ipcRenderer.invoke("project:export-file", projectName, subPath, destDir),
  },
  selectDir: (title) => ipcRenderer.invoke("dialog:select-dir", title),
  selectZipFile: () => ipcRenderer.invoke("dialog:select-zip-file"),
  onExportProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("export:progress", handler);
    return () => ipcRenderer.removeListener("export:progress", handler);
  },
  // ---- 数据库 API ----
  importPoints: (rows, stationName, stationCode, projectName) =>
    ipcRenderer
      .invoke("db:importPoints", rows, stationName, stationCode, projectName)
      .then((r) => {
        if (!r.ok) throw new Error(r.error);
        return r.data;
      }),
  saveCabinetMainDevices: (projectName, payload) =>
    ipcRenderer
      .invoke("db:saveCabinetMainDevices", projectName, payload)
      .then((r) => {
        if (!r.ok) throw new Error(r.error);
        return r.data;
      }),
  deleteCabinetMainDevices: (projectName, payload) =>
    ipcRenderer
      .invoke("db:deleteCabinetMainDevices", projectName, payload)
      .then((r) => {
        if (!r.ok) throw new Error(r.error);
        return r.data;
      }),
  exportZip: (projectName, items, destDir) =>
    ipcRenderer.invoke("project:export-zip", projectName, items, destDir),
  /** 解压 ZIP 文件到指定目录 */
  extractZip: (zipPath, destDir) => ipcRenderer.invoke("extract-zip", zipPath, destDir),
  importSurveyData: (projectName, mapName, zipPath) =>
    ipcRenderer.invoke("import-survey-data", projectName, mapName, zipPath),
  exportSurveyData: (projectName, mapName, destDir) =>
    ipcRenderer.invoke("export-survey-data", projectName, mapName, destDir),
  exportImageLabels: (projectName, mapName, destDir) =>
    ipcRenderer.invoke("export-image-labels", projectName, mapName, destDir),
  importImageLabels: (projectName, mapName, zipPath) =>
    ipcRenderer.invoke("import-image-labels", projectName, mapName, zipPath),
  importCabinetImagePackage: (zipPath) =>
    ipcRenderer.invoke("import-cabinet-image-package", zipPath),
  loadCabinetImage: (sourceId) =>
    ipcRenderer.invoke("load-cabinet-image", sourceId),
  importDeviceVerificationPackage: (projectName, sourcePath) =>
    ipcRenderer.invoke("device-verify:import-package", projectName, sourcePath),
  loadLocalDeviceVerificationPackage: (projectName) =>
    ipcRenderer.invoke("device-verify:load-local", projectName),
  loadDeviceVerificationChildren: (sessionId, parentId) =>
    ipcRenderer.invoke("device-verify:list-children", sessionId, parentId),
  loadDeviceVerificationImage: (sessionId, pointNodeId) =>
    ipcRenderer.invoke("device-verify:load-image", sessionId, pointNodeId),
  loadDeviceCorrection: (projectName, pointCode) =>
    ipcRenderer.invoke("device-verify:load-correction", projectName, pointCode),
  saveDeviceCorrection: (projectName, record) =>
    ipcRenderer.invoke("device-verify:save-correction", projectName, record),
  deleteDeviceCorrection: (projectName, pointCode) =>
    ipcRenderer.invoke("device-verify:delete-correction", projectName, pointCode),
  setDevicePointMark: (projectName, record) =>
    ipcRenderer.invoke("device-verify:set-point-mark", projectName, record),
  exportMarkedDevicePoints: (projectName, destDir) =>
    ipcRenderer.invoke("device-verify:export-marked-points", projectName, destDir),
  getProjectRoot: () => ipcRenderer.invoke("get-project-root"),
  setDataPath: (newPath) => ipcRenderer.invoke("set-data-path", newPath),
  startBatch: () => ipcRenderer.invoke("db:startBatch"),
  endBatch: () => ipcRenderer.invoke("db:endBatch"),

  db: {
    voltage: {
      list: dbInvoke("voltage", "list"),
      getById: dbInvoke("voltage", "getById"),
      findByStationId: dbInvoke("voltage", "findByStationId"),
      create: dbInvoke("voltage", "create"),
      update: dbInvoke("voltage", "update"),
      delete: dbInvoke("voltage", "delete"),
    },
    bay: {
      list: dbInvoke("bay", "list"),
      getById: dbInvoke("bay", "getById"),
      findByVoltId: dbInvoke("bay", "findByVoltId"),
      findByStationId: dbInvoke("bay", "findByStationId"),
      create: dbInvoke("bay", "create"),
      update: dbInvoke("bay", "update"),
      delete: dbInvoke("bay", "delete"),
    },
    mainDevice: {
      list: dbInvoke("mainDevice", "list"),
      getById: dbInvoke("mainDevice", "getById"),
      findByBayId: dbInvoke("mainDevice", "findByBayId"),
      findByStationId: dbInvoke("mainDevice", "findByStationId"),
      findByMainDeviceNameAndBayId: dbInvoke("mainDevice", "findByMainDeviceNameAndBayId"),
      findByMainDeviceCode: dbInvoke("mainDevice", "findByMainDeviceCode"),
      create: dbInvoke("mainDevice", "create"),
      update: dbInvoke("mainDevice", "update"),
      delete: dbInvoke("mainDevice", "delete"),
      deleteCascade: dbInvoke("mainDevice", "deleteCascade"),
    },
    component: {
      list: dbInvoke("component", "list"),
      getById: dbInvoke("component", "getById"),
      findByMainDeviceId: dbInvoke("component", "findByMainDeviceId"),
      findByStationId: dbInvoke("component", "findByStationId"),
      create: dbInvoke("component", "create"),
      update: dbInvoke("component", "update"),
      delete: dbInvoke("component", "delete"),
    },
    point: {
      list: dbInvoke("point", "list"),
      getById: dbInvoke("point", "getById"),
      findByPointCode: dbInvoke("point", "findByPointCode"),
      findByCalibrationId: dbInvoke("point", "findByCalibrationId"),
      bindCalibrationId: dbInvoke("point", "bindCalibrationId"),
      clearCalibrationId: dbInvoke("point", "clearCalibrationId"),
      findByStationId: dbInvoke("point", "findByStationId"),
      findByComponentId: dbInvoke("point", "findByComponentId"),
      paginate: dbInvoke("point", "paginate"),
      create: dbInvoke("point", "create"),
      update: dbInvoke("point", "update"),
      delete: dbInvoke("point", "delete"),
    },
  },
});
