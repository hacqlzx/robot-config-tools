import {
  POTREE_SCRIPTS,
  POTREE_STYLESHEETS,
  resolvePotreeAssetUrl,
} from "./potree-assets";

export interface PotreePointCloud {
  name: string;
  visible: boolean;
  material: {
    size: number;
    pointSizeType: unknown;
    activeAttributeName?: string;
    dispose?: () => void;
  };
  pcoGeometry?: {
    root?: PotreeGeometryNode;
    numPoints?: number;
    loader?: {
      metadata?: {
        points?: number;
      };
    };
  };
  getAttribute?: (name: string) => unknown;
}

export interface PotreePointCloudIntersection {
  location: PotreeVector3;
  distance: number;
  pointcloud: PotreePointCloud;
}

export interface PotreeRay {
  origin: PotreeVector3;
  direction: PotreeVector3;
}

export interface PotreeGeometryNode {
  children?: Record<string, PotreeGeometryNode> | PotreeGeometryNode[];
  dispose?: () => void;
}

export interface PotreeVector3 {
  x: number;
  y: number;
  z: number;
}

export interface PotreeView {
  direction: PotreeVector3;
  position: PotreeVector3;
  radius: number;
  translate: (x: number, y: number, z: number) => void;
  translateWorld: (x: number, y: number, z: number) => void;
}

export interface PotreeCamera {
  aspect: number;
  near: number;
  updateProjectionMatrix: () => void;
}

export interface PotreeViewerInstance {
  scene: {
    pointclouds: PotreePointCloud[];
    scenePointCloud: { remove: (pointcloud: PotreePointCloud) => void };
    addPointCloud: (pointcloud: PotreePointCloud) => void;
    getActiveCamera?: () => PotreeCamera;
    view: PotreeView;
  };
  renderer: {
    domElement: HTMLElement;
    setSize: (width: number, height: number) => void;
    setAnimationLoop: (callback: null) => void;
    dispose: () => void;
    forceContextLoss?: () => void;
  };
  setEDLEnabled: (enabled: boolean) => void;
  setFOV: (fov: number) => void;
  setMinNodeSize: (size: number) => void;
  setPointBudget: (budget: number) => void;
  setBackground: (background: string) => void;
  fitToScreen: () => void;
}

export interface PotreeNamespace {
  Viewer: new (host: HTMLElement) => PotreeViewerInstance;
  PointSizeType: {
    FIXED: unknown;
    ATTENUATED: unknown;
    ADAPTIVE: unknown;
  };
  Utils?: {
    mouseToRay: (
      mouse: { x: number; y: number },
      camera: PotreeCamera,
      width: number,
      height: number,
    ) => PotreeRay;
    getMousePointCloudIntersection: (
      mouse: { x: number; y: number },
      camera: PotreeCamera,
      viewer: PotreeViewerInstance,
      pointclouds: PotreePointCloud[],
      params?: { pickClipped?: boolean },
    ) => PotreePointCloudIntersection | null;
  };
  loadPointCloud: (
    metadataUrl: string,
    name: string,
  ) => Promise<{ type: string; pointcloud: PotreePointCloud }>;
  scriptPath?: string;
  resourcePath?: string;
}

let runtimePromise: Promise<PotreeNamespace> | null = null;

function ensureStylesheet(url: string): void {
  const existing = [...document.querySelectorAll<HTMLLinkElement>("link[data-potree-asset]")]
    .some((link) => link.dataset.potreeAsset === url);
  if (existing) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = url;
  link.dataset.potreeAsset = url;
  document.head.appendChild(link);
}

function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = [...document.querySelectorAll<HTMLScriptElement>("script[data-potree-asset]")]
      .find((script) => script.dataset.potreeAsset === url);
    if (existing?.dataset.loaded === "true") {
      resolve();
      return;
    }

    const script = existing || document.createElement("script");
    script.src = url;
    script.async = false;
    script.dataset.potreeAsset = url;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => {
      script.remove();
      reject(new Error(`Potree 资源加载失败：${url}`));
    }, { once: true });
    if (!existing) document.head.appendChild(script);
  });
}

export function loadPotreeRuntime(): Promise<PotreeNamespace> {
  if (runtimePromise) return runtimePromise;

  runtimePromise = (async () => {
    const baseUrl = document.baseURI;
    POTREE_STYLESHEETS.forEach((asset) => ensureStylesheet(resolvePotreeAssetUrl(asset, baseUrl)));
    for (const asset of POTREE_SCRIPTS) {
      await loadScript(resolvePotreeAssetUrl(asset, baseUrl));
    }

    const potree = (window as Window & { Potree?: PotreeNamespace }).Potree;
    if (!potree?.Viewer || !potree.loadPointCloud) {
      throw new Error("Potree 运行时初始化失败");
    }
    return potree;
  })().catch((error) => {
    runtimePromise = null;
    throw error;
  });

  return runtimePromise;
}
