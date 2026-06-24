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
import CabinetPanel from "./components/CabinetPanel";
import { saveCabinetDrawing, loadCabinetItems, loadCabinetItemsFromJson, type CabinetItem } from "./hooks/drawing/drawing-storage";
import { CabinetViewer } from "./hooks/drawing/CabinetViewer";

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
  const cabinetViewerRef = useRef<CabinetViewer | null>(null);
  const [drawingShown, setDrawingShown] = useState<Set<string>>(new Set());
  const shownByJsonRef = useRef<Map<string, number[]>>(new Map());
  const lasHeadersRef = useRef<Map<string, any>>(new Map());
  const filePathRef = useRef<Map<string, string>>(new Map());
  const pointStatsRef = useRef<Map<string, { total: number; loaded: number }>>(new Map());
  const renderDirtyRef = useRef(true);
  const modelExtentRef = useRef(10);
  const modelCenterRef = useRef({ x: 0, y: 0, z: 0 });
  const hasAutoFocusedRef = useRef(false);
  const { cabinetMode, cornerCount, cabinetCount, handleToggleCabinet, handleUndo, setCabinetNames, getCabinetGeometry, setupCabinetDrawing } = useCabinetDrawing();

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
        // 按需渲染(autoRender=false)下必须保留绘制缓冲，否则未重绘的帧缓冲被丢弃
        // 导致画面在正确帧与空帧间交替 → 抖动、远端忽隐忽现、裁切面闪现
        preserveDrawingBuffer: true,
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
    const viewer = new CabinetViewer(app, camera, requestRender);
    cabinetViewerRef.current = viewer;

    // 统一渲染循环：每帧先更新相机飞行(WASD)，再按需渲染，避免飞行与渲染分属两个 rAF 循环导致顿挫
    let renderRafId = 0;
    let lastFrameTime = performance.now();
    const renderLoop = () => {
      const now = performance.now();
      const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
      lastFrameTime = now;
      orbitRef.current?.updateFly(dt);
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
      viewer.destroy();
      cabinetViewerRef.current = null;
      orbit.destroy();
      app.destroy();
    };
  }, []);

  // 大模型显示比例：渲染后更新 uDisplayRatio
  useEffect(() => {
    if (loadedFiles.size === 0) return;
    entitiesRef.current.forEach((ent) => {
      // 只对 GSplat 实体应用显示比例，pointcloud 已通过 stride 控制 GPU 预算
      if (!ent.gsplat) return;
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
    const orbit = orbitRef.current;
    if (orbit) {
      // 把场景尺寸告知相机，近/远裁剪面由 updateCamera 随距离实时维护，避免大模型被裁剪面切掉
      orbit.sceneRadius = Math.max(orbit.sceneRadius, extent);
      orbit.sceneCenter.set(centerX, centerY, centerZ);
      orbit.maxDistance = Math.max(orbit.maxDistance, extent * 5);
      if (!hasAutoFocusedRef.current) {
        hasAutoFocusedRef.current = true;
        orbit.lookAt.set(centerX, centerY, centerZ);
        orbit.distance = extent * 1.5;
      }
      orbit.updateCamera();
      requestRender();
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
      const { rows, stationName } = await parsePointExcel(file);

      if (rows.length === 0) {
        message.warning("Excel 中无有效数据行");
        setImporting(false);
        return;
      }

      if (!stationName) {
        message.warning("Excel 中未找到厂站名称");
        setImporting(false);
        return;
      }

      const api = (window as any).electronAPI;
      if (!api) {
        message.warning("仅 Electron 模式下可用");
        setImporting(false);
        return;
      }

      // 用站名生成 stationCode
      const stationCode = stationName.substring(0, 10) + Date.now().toString().slice(-4);

      // 获取当前项目名
      const projectName = localStorage.getItem("selectedProject") || "默认项目";

      console.log("[点表导入] 项目:", projectName, "站名:", stationName, "开始导入", rows.length, "行...");
      await api.startBatch();
      const result = await api.importPoints(rows, stationName, stationCode, projectName);
      await api.endBatch();

      console.log("[点表导入] 导入完成:", result);
      message.success("导入成功: " + result.inserted + " 新增, " + result.updated + " 更新");
      if (result.errors.length > 0) {
        message.warning("错误: " + result.errors.slice(0, 3).join("; "));
      }
    } catch (e: any) {
      message.error("导入失败: " + e.message);
    } finally {
      setImporting(false);
    }
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

  /** 保存屏柜：写入当前模型目录下的绘制 JSON（按 type 隔离，创建/更新） */
  const handleSaveCabinet = useCallback(async (data: { area: { id: number; name: string; code: string }; bay: { id: number; name: string; code: string }; rows: { key: string; code: string; name: string }[] }) => {
    const api = window.electronAPI;
    if (!api) { message.warning("仅 Electron 模式下可保存"); return; }
    const projectName = localStorage.getItem("selectedProject");
    if (!projectName) { message.warning("请先选择项目"); return; }
    const geometry = getCabinetGeometry();
    if (!geometry) { message.warning("请先完成屏柜绘制（四点成体）"); return; }

    // 当前绘制模型路径：优先可见且有路径的模型
    let modelPath = "";
    for (const [name, ent] of entitiesRef.current) {
      const p = filePathRef.current.get(name);
      if (ent.enabled && p) { modelPath = p; break; }
    }
    if (!modelPath) {
      const first = filePathRef.current.values().next().value;
      if (first) modelPath = first;
    }
    if (!modelPath) { message.warning("未找到绘制模型，无法保存"); return; }

    const item: CabinetItem = {
      id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
      type: "cabinet",
      area: data.area,
      bay: data.bay,
      geometry,
      cabinets: data.rows.map((r) => ({ code: r.code, name: r.name })),
      updatedAt: new Date().toISOString(),
    };
    try {
      await saveCabinetDrawing({ api, projectName, modelPath, item });
      message.success(`保存成功（${item.cabinets.length} 个屏柜）`);
    } catch (e: any) {
      message.error("保存失败: " + (e?.message || e));
    }
  }, [getCabinetGeometry, message]);

  /** 当前绘制模型路径：优先可见且有路径的模型 */
  const getCurrentModelPath = useCallback((): string => {
    for (const [name, ent] of entitiesRef.current) {
      const p = filePathRef.current.get(name);
      if (ent.enabled && p) return p;
    }
    return filePathRef.current.values().next().value || "";
  }, []);

  /** 屏柜树勾选变化：读该模型 JSON，按勾选的间隔回显/隐藏屏柜 */
  const handleCabinetCheck = useCallback(async (bayIds: number[]) => {
    const viewer = cabinetViewerRef.current;
    const api = window.electronAPI;
    if (!viewer || !api) return;
    const modelPath = getCurrentModelPath();
    if (!modelPath) return;
    let items: CabinetItem[] = [];
    try {
      items = await loadCabinetItems(api, modelPath);
    } catch {
      return;
    }
    const byBay = new Map(items.map((it) => [it.bay.id, it]));
    const want = new Set(bayIds.filter((id) => byBay.has(id)));
    for (const id of viewer.getShownIds()) if (!want.has(id)) viewer.hide(id);
    for (const id of want) if (!viewer.has(id)) viewer.show(byBay.get(id)!);
  }, [getCurrentModelPath]);

  /** 地图树勾选绘制 json：回显/隐藏其中的屏柜 */
  const handleToggleDrawing = useCallback(async (jsonPath: string, checked: boolean) => {
    const viewer = cabinetViewerRef.current;
    const api = window.electronAPI;
    if (!viewer || !api) return;
    if (checked) {
      const items = await loadCabinetItemsFromJson(api, jsonPath);
      items.forEach((it) => viewer.show(it));
      shownByJsonRef.current.set(jsonPath, items.map((it) => it.bay.id));
      setDrawingShown((prev) => new Set(prev).add(jsonPath));
    } else {
      const ids = shownByJsonRef.current.get(jsonPath) || [];
      ids.forEach((id) => viewer.hide(id));
      shownByJsonRef.current.delete(jsonPath);
      setDrawingShown((prev) => {
        const next = new Set(prev);
        next.delete(jsonPath);
        return next;
      });
    }
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
          onCabinetCheck={handleCabinetCheck}
          mapDrawingShown={drawingShown}
          onToggleDrawing={handleToggleDrawing}
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
          {cabinetMode && (
            <CabinetPanel
              cornerCount={cornerCount}
              cabinetCount={cabinetCount}
              onUndo={handleUndo}
              onClose={handleToggleCabinet}
              onSave={handleSaveCabinet}
              onNamesChange={setCabinetNames}
            />
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
      {importing && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "all" }}>
          <Spin size="large" />
          <div style={{ color: "#fff", marginTop: 16, fontSize: 14 }}>正在导入点表...</div>
        </div>
      )}
    </div>
  );
}



