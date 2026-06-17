import { useRef, useEffect, useState, useCallback } from "react";
import { parsePointExcel } from "@/utils/excel-parser";
import { useLasLoader } from "./hooks/useLasLoader";
import * as pc from "playcanvas";
import { useCabinetDrawing } from "./hooks/useCabinetDrawing";
import { Spin, App } from "antd";
import { SimpleOrbitCamera } from "../../playcanvas-core/simple-camera";

/** 根据点数和硬件决定加载比例 */
function getLoadFraction(pointCount: number): number {
  if (pointCount > 20_000_000) return 0.25;
  if (pointCount > 10_000_000) return 0.5;
  return 1;
}

import Toolbar from "./components/Toolbar";
import ViewCube from "./components/ViewCube";
import SidePanel from "./components/SidePanel";
import ClipController from "./components/ClipController";

export default function SpaceEdit() {
  const { message } = App.useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const orbitRef = useRef<SimpleOrbitCamera | null>(null);
  const appRef = useRef<pc.Application | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [loadingFile, setLoadingFile] = useState("");
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingText, setLoadingText] = useState("");
  const [loadedFiles, setLoadedFiles] = useState<Set<string>>(new Set());
  const [hiddenFiles, setHiddenFiles] = useState<Set<string>>(new Set());
  const [treeKey, setTreeKey] = useState(0);
  const [clipMode, setClipMode] = useState(false);
  const [clipEntityName, setClipEntityName] = useState("");
  const entitiesRef = useRef<Map<string, pc.Entity>>(new Map());
  const lasHeadersRef = useRef<Map<string, any>>(new Map());
  const filePathRef = useRef<Map<string, string>>(new Map());
  const pointStatsRef = useRef<Map<string, { total: number; loaded: number }>>(new Map());
  const renderDirtyRef = useRef(true);
  const modelExtentRef = useRef(10);
  const modelCenterRef = useRef({ x: 0, y: 0, z: 0 });
  const hasAutoFocusedRef = useRef(false);
  const { cabinetMode, handleToggleCabinet, setupCabinetDrawing } = useCabinetDrawing();

  /** 按需渲染：标记脏位，rAF 循环检测到后执行一次 app.render() */
  const requestRender = useCallback(() => {
    renderDirtyRef.current = true;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const app = new pc.Application(canvas, {
      mouse: new pc.Mouse(canvas),
      touch: new pc.TouchDevice(canvas),
      keyboard: new pc.Keyboard(window),
      componentSystems: [
        pc.AnimComponentSystem,
        pc.RenderComponentSystem,
        pc.CameraComponentSystem,
        pc.LightComponentSystem,
        pc.GSplatComponentSystem,
      ],
      resourceHandlers: [
        pc.RenderHandler,
        pc.AnimClipHandler,
        pc.TextureHandler,
        pc.CubemapHandler,
        pc.ContainerHandler,
        pc.GSplatHandler,
      ],
      graphicsDeviceOptions: {
        preferWebGl2: true,
        powerPreference: "high-performance",
      },
    } as any);

    let rafId: number;
    const doResize = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const cvs = canvasRef.current;
        const ct = containerRef.current;
        if (!cvs || !ct || !app.graphicsDevice) return;
        const rect = ct.getBoundingClientRect();
        const w = Math.floor(rect.width);
        const h = Math.floor(rect.height);
        if (w > 0 && h > 0 && (cvs.width !== w || cvs.height !== h)) {
          cvs.width = w;
          cvs.height = h;
          app.resizeCanvas(w, h);
        }
        renderDirtyRef.current = true;
      });
    };
    const observer = new ResizeObserver(doResize);
    observer.observe(container);
    window.addEventListener("resize", doResize);
    doResize();

    app.scene.ambientLight = new pc.Color(0.3, 0.3, 0.3);
    const light = new pc.Entity("light");
    light.addComponent("light", { type: "directional", color: pc.Color.WHITE, intensity: 1 });
    light.setEulerAngles(45, 45, 0);
    app.root.addChild(light);

    const camera = new pc.Entity("camera");
    camera.addComponent("camera", { fov: 60, clearColor: new pc.Color(0.12, 0.12, 0.12) });
    app.root.addChild(camera);

    const orbit = new SimpleOrbitCamera(app, camera, () => { renderDirtyRef.current = true; });
    orbitRef.current = orbit;
    app.graphicsDevice.maxPixelRatio = 1;

    // P0: 关闭持续渲染循环，改用按需渲染
    app.autoRender = false;
    app.start();
    appRef.current = app;
    const cabinetCleanup = setupCabinetDrawing(app, camera, requestRender, entitiesRef);

    // 按需渲染循环：仅脏标记为 true 时执行一帧
    let renderRafId = 0;
    const renderLoop = () => {
      if (renderDirtyRef.current) {
        app.render();
        renderDirtyRef.current = false;
      }
      renderRafId = requestAnimationFrame(renderLoop);
    };
    renderRafId = requestAnimationFrame(renderLoop);

    return () => {
      window.removeEventListener("resize", doResize);
      observer.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      if (renderRafId) cancelAnimationFrame(renderRafId);
      cabinetCleanup();
      orbit.destroy();
      app.destroy();
    };
  }, []);

  // 大模型显示比例：渲染后更新 uDisplayRatio
  useEffect(() => {
    if (loadedFiles.size === 0) return;
    entitiesRef.current.forEach((ent) => {
      const mi = ent.render?.meshInstances?.[0];
      if (mi?.material) {
        const vb = mi.mesh?.vertexBuffer;
        if (vb) {
          (mi.material as any).setParameter?.("uDisplayRatio", getLoadFraction(vb.getNumVertices()));
          mi.material.update?.();
        }
      }
    });
    requestRender();
  }, [loadedFiles]);

const handleViewChange = useCallback((direction: "前" | "后" | "左" | "右" | "上" | "下") => {
    const orbit = orbitRef.current;
    if (!orbit) return;
    const c = modelCenterRef.current;
    const ext = modelExtentRef.current;
    console.log("[视角] 方向:", direction, "中心:", c.x.toFixed(1), c.y.toFixed(1), c.z.toFixed(1), "范围:", ext.toFixed(1));
    orbit.lookAt.set(c.x, c.y, c.z);
    orbit.distance = ext * 1.5;
    orbit.setViewDirection(direction);
    orbit.updateCamera();
    requestRender();
  }, [])

  /** 将相机焦点移到指定位置 */const focusOnModel = useCallback((centerX: number, centerY: number, centerZ: number, extent: number) => {
    modelExtentRef.current = extent;
    modelCenterRef.current = { x: centerX, y: centerY, z: centerZ };
    if (!hasAutoFocusedRef.current) {
      hasAutoFocusedRef.current = true;
      const orbit = orbitRef.current;
      if (orbit) {
        orbit.lookAt.set(centerX, centerY, centerZ);
        orbit.distance = extent * 1.5;
        orbit.updateCamera();
        requestRender();
      }
    }
  }, [])

  const { loadLas, loadPly, loadLasFromPath } = useLasLoader({
    appRef, entitiesRef, lasHeadersRef, filePathRef, pointStatsRef,
    requestRender, focusOnModel,
    setLoading, setLoadingFile, setLoadingText, setLoadingProgress,
    setLoadedFiles, setTreeKey,
  });

  /** 点表 Excel 导入 */
  const handleImportPointTable = async (file: File) => {
    setImporting(true);
    try {
      // 1. 解析 Excel，取站名
      const { rows, stationName } = await parsePointExcel(file);

      if (rows.length === 0) {
        message.warning("未解析到有效数据行");
        setImporting(false);
        return;
      }

      if (!stationName) {
        message.warning("Excel 中未找到厂站名称");
        setImporting(false);
        return;
      }

      // 2. Electron 模式：通过 IPC 导入
      const api = (window as any).electronAPI;
      if (api) {
        console.log("[点表导入] 站名:", stationName);

        // 优先查找已有同名校验
        const stations = await api.db.station.list();
        console.log("[点表导入] 已有厂站列表:", stations.map((s: any) => ({ id: s.id, code: s.stationCode, name: s.stationName })));

        let station = stations.find((s: any) => s.stationName === stationName);

        if (!station) {
          // 用站名生成 stationCode
          const stationCode = stationName.substring(0, 10) + Date.now().toString().slice(-4);
          station = await api.db.station.create({
            stationName, stationCode,
            outStationCode: "", facType: "1", stationType: "1",
            provinceName: "", cityName: "", areaName: "",
            createBy: "import", updateBy: "import", voltName: rows[0]?.voltName ?? "",
            useTime: "", responsiblePerson: "", telephone: "",
            envDataRobotId: 0, currentFac: 1, alarmLevel: 0, sortNum: 1,
          });
          console.log("[????] ????:", { id: station.id, name: station.stationName });
        }

        if (!station || !station.id) {
          message.error('??????');
          setImporting(false);
          return;
        }

        console.log("[点表导入] 开始导入，共", rows.length, "行...");
        await api.startBatch();
        const result = await api.importPoints(rows, station.id, station.stationName, station.stationCode);
        await api.endBatch();

        console.log("[点表导入] 导入完成:", result);
        message.success("import success: " + result.inserted + " new, " + result.updated + " updated");
        if (result.errors.length > 0) {
          message.warning("errors: " + result.errors.slice(0, 3).join("; "));
        }
      } else {
        message.warning("import only available in Electron mode");
      }
    } catch (e: any) {
      message.error("import failed: " + e.message);
    }
    setImporting(false);
  };

  const handleFileSelect = async (file: File) => {
    if (window.electronAPI) {
      const sourcePath = window.electronAPI.getFilePath(file);
      const baseName = file.name.replace(/\.[^.]+$/, "");
      const selectedProject = localStorage.getItem("selectedProject");
      if (sourcePath && selectedProject) {
        try {
          await window.electronAPI.project.importFile(selectedProject, sourcePath, baseName);
        } catch (err: any) {
          console.error("文件导入失败:", err.message);
        }
      }
    }

    const ext = file.name.toLowerCase().split(".").pop();
    if (ext === "las" || ext === "laz") {
      loadLas(file);
    } else {
      loadPly(file);
    }
    setLoadedFiles((prev) => new Set([...prev, file.name]));
    setTreeKey((k) => k + 1);
  };

  const handleToggleVisible = useCallback((filePath: string) => {
    const entityName = filePath.split(/[\\/]/).pop() || filePath;
    const entity = entitiesRef.current.get(entityName);
    if (!entity) return;

    const isHidden = hiddenFiles.has(filePath);
    if (isHidden) {
      entity.enabled = true;
      setHiddenFiles((prev) => {
        const next = new Set(prev);
        next.delete(filePath);
        return next;
      });
    } else {
      entity.enabled = false;
      setHiddenFiles((prev) => new Set([...prev, filePath]));
    }
    requestRender();
  }, [hiddenFiles]);


  const handleClipModel = useCallback(() => {
    const entries = Array.from(entitiesRef.current.entries());
    if (entries.length === 0) {
      message.warning("请先加载模型");
      return;
    }

    entries.forEach(([key, ent]) => {
      if (!ent.enabled) {
        ent.destroy();
        entitiesRef.current.delete(key);
      }
    });

    const visible = Array.from(entitiesRef.current.entries());
    if (visible.length > 1) {
      message.warning("存在多个可见模型，请只保留一个模型后再裁切");
      return;
    }
    if (visible.length === 0) {
      message.warning("没有可见模型");
      return;
    }

    setClipEntityName(visible[0][0]);
    setClipMode(true);
  }, []);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Toolbar onFileSelect={handleFileSelect} onClipModel={handleClipModel} cabinetMode={cabinetMode} onToggleCabinet={handleToggleCabinet} onImportPointTable={handleImportPointTable} importing={importing} />
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <ViewCube onViewChange={handleViewChange} />
        <SidePanel
          treeKey={treeKey}
          onLoadLas={loadLasFromPath}
          onToggleVisible={handleToggleVisible}
          loadedFiles={loadedFiles}
          hiddenFiles={hiddenFiles}
          loadingFile={loadingFile}
        />
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", position: "absolute", top: 0, left: 0 }} />
          {(loading || loadingProgress > 0) && (
            <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "all" }}>
              <Spin size="large" />
              <div style={{ color: "#fff", marginTop: 16, fontSize: 14 }}>{loadingText || "处理中..."}</div>
              {loadingProgress > 0 && (
                <div style={{ width: 200, marginTop: 12 }}>
                  <div style={{ width: "100%", height: 4, background: "rgba(255,255,255,0.2)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${loadingProgress}%`, height: "100%", background: "#fff", borderRadius: 2, transition: "width 0.2s" }} />
                  </div>
                  <div style={{ color: "#fff", fontSize: 12, textAlign: "center", marginTop: 4 }}>{loadingProgress}%</div>
                </div>
              )}
            </div>
          )}
          {/* 点信息 */}
          {loadedFiles.size > 0 && (
            <div style={{ position: "absolute", bottom: 8, right: 8, background: "rgba(0,0,0,0.55)", color: "#ccc", padding: "4px 8px", borderRadius: 4, fontSize: 11, fontFamily: "monospace", lineHeight: 1.5, zIndex: 10, pointerEvents: "none", userSelect: "none" }}>
              {Array.from(loadedFiles).map((name) => {
                const stats = pointStatsRef.current.get(name);
                if (!stats) return null;
                const rate = stats.total > 0 ? (stats.loaded / stats.total * 100).toFixed(1) : "100";
                const isDown = stats.loaded < stats.total;
                return (
                  <div key={name}>
                    <div>{name}</div>
                    <div>总计: {stats.total.toLocaleString()} | 加载: {stats.loaded.toLocaleString()} {isDown ? `| 采样: ${rate}%` : ""}</div>
                  </div>
                );
              })}
            </div>
          )}
          {clipMode && appRef.current && (
            <ClipController
              app={appRef.current}
              entityName={clipEntityName}
              lasHeader={lasHeadersRef.current.get(clipEntityName) || null}
              origFilePath={filePathRef.current.get(clipEntityName) || ""}
              onClose={() => setClipMode(false)}
              onProgress={(pct) => { setLoadingProgress(pct); setLoadingText(pct >= 100 ? "" : "正在保存..."); }}
              onComplete={(clipName) => {
                setTreeKey((k) => k + 1);
                setLoadingText("");
                setLoadingProgress(0);
                if (clipName) {
                  const oldEnt = entitiesRef.current.get(clipEntityName);
                  if (oldEnt) { oldEnt.destroy(); entitiesRef.current.delete(clipEntityName); }
                  setLoadedFiles((prev) => { const next = new Set(prev); next.delete(clipEntityName); return next; });

                  setTimeout(async () => {
                    const project = localStorage.getItem("selectedProject");
                    if (project && window.electronAPI) {
                      const files = await window.electronAPI.project.listTree(project, `地图/${clipName}`);
                      const lasFile: any = files.find((f: any) => f.name.endsWith(".las"));
                      if (lasFile) loadLasFromPath(lasFile.path);
                    }
                  }, 500);
                }
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
