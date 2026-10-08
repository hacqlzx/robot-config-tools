import {
  POTREE_SCRIPTS,
  POTREE_STYLESHEETS,
  POTREE_THREE_MODULE,
  resolvePotreeAssetUrl,
} from "./potree-assets";

export interface PotreePointCloud {
  name: string;
  visible: boolean;
  numVisiblePoints?: number;
  position?: PotreeVector3;
  material: {
    size: number;
    pointSizeType: unknown;
    activeAttributeName?: string;
    rgbGamma: number;
    rgbBrightness: number;
    rgbContrast: number;
    intensityGamma: number;
    intensityBrightness: number;
    intensityContrast: number;
    dispose?: () => void;
  };
  pcoGeometry?: {
    boundingBox?: {
      min: PotreeVector3;
      max: PotreeVector3;
    };
    tightBoundingBox?: {
      min: PotreeVector3;
      max: PotreeVector3;
    };
    root?: PotreeGeometryNode;
    numPoints?: number;
    loader?: {
      abort?: () => void;
      metadata?: {
        points?: number;
      };
    };
  };
  visibleNodes?: PotreeVisibleNode[];
  pick?: (
    viewer: PotreeViewerInstance,
    camera: PotreeCamera,
    ray: PotreeRay,
    params?: {
      pickClipped?: boolean;
      x?: number;
      y?: number;
      pickWindowSize?: number;
      all?: boolean;
    },
  ) => unknown;
  getAttribute?: (name: string) => unknown;
}

export interface PotreeGeometryAttribute {
  array?: ArrayLike<number>;
  itemSize?: number;
  potree?: { scale?: number; offset?: number };
}

export interface PotreeGeometryData {
  attributes?: Record<string, PotreeGeometryAttribute>;
}

export interface PotreeVisibleNode {
  geometryNode?: {
    geometry?: PotreeGeometryData;
    boundingBox?: { min: PotreeVector3; max: PotreeVector3 };
    spacing?: number;
  };
  sceneNode?: {
    position?: PotreeVector3;
    matrixWorld?: { elements?: ArrayLike<number> };
  };
}

export interface PotreePointCloudIntersection {
  location: PotreeVector3;
  distance: number;
  pointcloud: PotreePointCloud;
  point?: Record<string, unknown>;
}

export interface PotreeRay {
  origin: PotreeVector3;
  direction: PotreeVector3;
}

export interface PotreeGeometryNode {
  id?: string | number;
  children?: Record<string, PotreeGeometryNode> | PotreeGeometryNode[];
  geometry?: { dispose: () => void } | null;
  loaded?: boolean;
  dispose?: () => void;
}

export interface PotreeNodeCache {
  remove: (node: PotreeGeometryNode) => void;
  freeMemory?: () => void;
  numPoints?: number;
}

export interface PotreeVector3 {
  x: number;
  y: number;
  z: number;
  set?: (x: number, y: number, z: number) => void;
  copy?: (value: PotreeVector3) => void;
}

export interface PotreeBoxVolume {
  position: PotreeVector3;
  scale: PotreeVector3;
  rotation: {
    x: number;
    y: number;
    z: number;
    set: (x: number, y: number, z: number) => void;
  };
  visible: boolean;
  clip: boolean;
  frame?: {
    visible?: boolean;
    material?: {
      color?: { setHex: (value: number) => void };
      depthTest?: boolean;
      depthWrite?: boolean;
    };
  };
  update?: () => void;
  addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  removeEventListener?: (type: string, listener: (event: unknown) => void) => void;
}

export interface PotreeTransformMaterial {
  opacity?: number;
  transparent?: boolean;
  depthTest?: boolean;
  depthWrite?: boolean;
  needsUpdate?: boolean;
  color?: { setHex: (value: number) => void };
}

export interface PotreeTransformObject {
  name?: string;
  visible: boolean;
  renderOrder?: number;
  position?: { set: (x: number, y: number, z: number) => void };
  scale?: {
    x?: number;
    y?: number;
    z?: number;
    multiplyScalar?: (value: number) => void;
  };
  material?: PotreeTransformMaterial | PotreeTransformMaterial[];
  add?: (...objects: PotreeTransformObject[]) => void;
  setOpacity?: (opacity: number) => void;
  traverse?: (callback: (object: PotreeTransformObject) => void) => void;
}

export interface PotreeTransformHandle {
  node?: PotreeTransformObject;
}

export interface PotreeView {
  direction: PotreeVector3;
  position: PotreeVector3;
  radius: number;
  yaw: number;
  pitch: number;
  lookAt?: (x: number, y: number, z: number) => void;
  translate: (x: number, y: number, z: number) => void;
  translateWorld: (x: number, y: number, z: number) => void;
}

export interface PotreeCamera {
  aspect: number;
  fov?: number;
  near: number;
  updateProjectionMatrix: () => void;
}

export interface PotreeControls {
  addEventListener: (type: string, listener: (event: unknown) => void) => void;
  removeEventListener: (type: string, listener: (event: unknown) => void) => void;
  stop?: () => void;
  update?: (delta: number) => void;
  yawDelta?: number;
  pitchDelta?: number;
  panDelta?: { x: number; y: number };
  rotationSpeed?: number;
}

export interface PotreeThreeDisposable {
  dispose: () => void;
}

export interface PotreeThreeBufferGeometry extends PotreeThreeDisposable {
  setAttribute: (name: string, attribute: unknown) => PotreeThreeBufferGeometry;
  computeBoundingSphere: () => void;
  rotateX: (angle: number) => PotreeThreeBufferGeometry;
}

export interface PotreeThreeObject3D {
  name?: string;
  visible?: boolean;
  renderOrder?: number;
  position: { set: (x: number, y: number, z: number) => void };
  scale: { set: (x: number, y: number, z: number) => void };
  up: { set: (x: number, y: number, z: number) => void };
  matrixWorld?: { elements?: ArrayLike<number> };
  geometry?: PotreeThreeDisposable;
  material?: PotreeThreeDisposable | PotreeThreeDisposable[];
  target?: PotreeThreeObject3D;
  add: (...objects: PotreeThreeObject3D[]) => void;
  remove: (...objects: PotreeThreeObject3D[]) => void;
  lookAt: (x: number, y: number, z: number) => void;
  traverse: (callback: (object: PotreeThreeObject3D) => void) => void;
}

export interface PotreeThreeVector3 {
  x: number;
  y: number;
  z: number;
  project: (camera: unknown) => PotreeThreeVector3;
}

export interface PotreeThreeNamespace {
  Scene: new () => PotreeThreeObject3D;
  Group: new () => PotreeThreeObject3D;
  AmbientLight: new (color?: number, intensity?: number) => PotreeThreeObject3D;
  DirectionalLight: new (color?: number, intensity?: number) => PotreeThreeObject3D;
  Vector3: new (x?: number, y?: number, z?: number) => PotreeThreeVector3;
  BufferGeometry: new () => PotreeThreeBufferGeometry;
  Float32BufferAttribute: new (values: number[], itemSize: number) => unknown;
  LineBasicMaterial: new (parameters: Record<string, unknown>) => PotreeThreeDisposable;
  LineSegments: new (
    geometry: PotreeThreeBufferGeometry,
    material: PotreeThreeDisposable,
  ) => PotreeThreeObject3D;
  PointsMaterial: new (parameters: Record<string, unknown>) => PotreeThreeDisposable;
  Points: new (
    geometry: PotreeThreeBufferGeometry,
    material: PotreeThreeDisposable,
  ) => PotreeThreeObject3D;
  BoxGeometry: new (width?: number, height?: number, depth?: number) => PotreeThreeDisposable;
  CylinderGeometry: new (
    radiusTop?: number,
    radiusBottom?: number,
    height?: number,
    radialSegments?: number,
    heightSegments?: number,
    openEnded?: boolean,
  ) => PotreeThreeBufferGeometry;
  ConeGeometry: new (
    radius?: number,
    height?: number,
    radialSegments?: number,
    heightSegments?: number,
    openEnded?: boolean,
  ) => PotreeThreeBufferGeometry;
  TorusGeometry: new (
    radius?: number,
    tube?: number,
    radialSegments?: number,
    tubularSegments?: number,
    arc?: number,
  ) => PotreeThreeBufferGeometry;
  SphereGeometry: new (
    radius?: number,
    widthSegments?: number,
    heightSegments?: number,
  ) => PotreeThreeDisposable;
  MeshBasicMaterial: new (parameters: Record<string, unknown>) => PotreeThreeDisposable & PotreeTransformMaterial;
  MeshPhongMaterial: new (parameters: Record<string, unknown>) => PotreeThreeDisposable & PotreeTransformMaterial;
  Mesh: new (
    geometry: PotreeThreeDisposable,
    material: PotreeThreeDisposable,
  ) => PotreeThreeObject3D;
}

export interface PotreeViewerInstance {
  performanceStats?: {
    frameCount: number;
    longFrames: number;
    workMs: number;
    updateMs: number;
    renderMs: number;
    drawCalls: number;
  };
  pRenderer?: {
    buffers: Map<unknown, unknown>;
  };
  setRenderingPaused?: (paused: boolean) => void;
  loop?: (timestamp: number) => void;
  update?: (delta: number, timestamp: number) => void;
  clock?: { getDelta: () => number };
  scene: {
    pointclouds: PotreePointCloud[];
    volumes: PotreeBoxVolume[];
    scenePointCloud: { remove: (pointcloud: PotreePointCloud) => void };
    addPointCloud: (pointcloud: PotreePointCloud) => void;
    addVolume: (volume: PotreeBoxVolume) => void;
    removeVolume: (volume: PotreeBoxVolume) => void;
    getActiveCamera?: () => PotreeCamera;
    view: PotreeView;
  };
  renderer: {
    domElement: HTMLElement;
    info?: {
      render?: {
        calls?: number;
        triangles?: number;
      };
      memory?: {
        geometries?: number;
        textures?: number;
      };
    };
    setSize: (width: number, height: number) => void;
    render: (scene: unknown, camera: PotreeCamera) => void;
    setAnimationLoop: (callback: ((timestamp: number) => void) | null) => void;
    dispose: () => void;
    forceContextLoss?: () => void;
  };
  setEDLEnabled: (enabled: boolean) => void;
  setFOV: (fov: number) => void;
  setMinNodeSize: (size: number) => void;
  setPointBudget: (budget: number) => void;
  setBackground: (background: string) => void;
  setView: (view: "F" | "B" | "L" | "R" | "U" | "D") => void;
  fitToScreen: () => void;
  setClipTask: (task: number) => void;
  setClipMethod: (method: number) => void;
  clipTask?: number;
  clipMethod?: number;
  controls?: PotreeControls;
  inputHandler?: {
    deselectAll: () => void;
    deselect: (object: PotreeBoxVolume) => void;
    toggleSelection: (object: PotreeBoxVolume) => void;
  };
  transformationTool?: {
    scene?: PotreeThreeObject3D;
    selection?: PotreeBoxVolume[];
    scaleHandles?: Record<string, PotreeTransformHandle>;
    focusHandles?: Record<string, PotreeTransformHandle>;
    translationHandles?: Record<string, PotreeTransformHandle>;
    rotationHandles?: Record<string, PotreeTransformHandle>;
  };
  addEventListener: (type: string, listener: (event: unknown) => void) => void;
  removeEventListener: (type: string, listener: (event: unknown) => void) => void;
}

export interface PotreeNamespace {
  Viewer: new (host: HTMLElement) => PotreeViewerInstance;
  BoxVolume: new () => PotreeBoxVolume;
  ClipTask: {
    NONE: number;
    HIGHLIGHT: number;
    SHOW_INSIDE: number;
    SHOW_OUTSIDE: number;
  };
  ClipMethod: {
    INSIDE_ANY: number;
    INSIDE_ALL: number;
  };
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
    callback?: undefined,
    options?: { signal?: AbortSignal },
  ) => Promise<{ type: string; pointcloud: PotreePointCloud }>;
  lru?: PotreeNodeCache;
  scriptPath?: string;
  resourcePath?: string;
}

let runtimePromise: Promise<PotreeNamespace> | null = null;
let threeRuntimePromise: Promise<PotreeThreeNamespace> | null = null;

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

export function loadPotreeThreeRuntime(): Promise<PotreeThreeNamespace> {
  if (threeRuntimePromise) return threeRuntimePromise;

  const url = resolvePotreeAssetUrl(POTREE_THREE_MODULE, document.baseURI);
  threeRuntimePromise = import(/* @vite-ignore */ url)
    .then((module) => {
      if (!module.Scene || !module.Group || !module.Mesh || !module.BoxGeometry || !module.SphereGeometry || !module.TorusGeometry
        || !module.BufferGeometry || !module.Float32BufferAttribute || !module.LineBasicMaterial || !module.LineSegments
        || !module.AmbientLight || !module.DirectionalLight || !module.MeshPhongMaterial) {
        throw new Error("Potree Three.js 运行时初始化失败");
      }
      return module as unknown as PotreeThreeNamespace;
    })
    .catch((error) => {
      threeRuntimePromise = null;
      throw error;
    });

  return threeRuntimePromise;
}
