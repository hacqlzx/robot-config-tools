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
    importFile: (projectName, sourcePath, fileName) =>
      ipcRenderer.invoke("project:import-file", projectName, sourcePath, fileName),
    listTree: (projectName, subDir) =>
      ipcRenderer.invoke("project:list-tree", projectName, subDir),
    writeFile: (projectName, subPath, data) =>
      ipcRenderer.invoke("project:write-file", projectName, subPath, data),
    deletePath: (targetPath) =>
      ipcRenderer.invoke("project:delete-path", targetPath),
    renamePath: (targetPath, newName) =>
      ipcRenderer.invoke("project:rename-path", targetPath, newName),
  },
  // ---- 数据库 API ----
  importPoints: (rows, stationName, stationCode, projectName) =>
    ipcRenderer
      .invoke("db:importPoints", rows, stationName, stationCode, projectName)
      .then((r) => {
        if (!r.ok) throw new Error(r.error);
        return r.data;
      }),
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
      create: dbInvoke("mainDevice", "create"),
      update: dbInvoke("mainDevice", "update"),
      delete: dbInvoke("mainDevice", "delete"),
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
      findByStationId: dbInvoke("point", "findByStationId"),
      findByComponentId: dbInvoke("point", "findByComponentId"),
      paginate: dbInvoke("point", "paginate"),
      create: dbInvoke("point", "create"),
      update: dbInvoke("point", "update"),
      delete: dbInvoke("point", "delete"),
    },
  },
});
