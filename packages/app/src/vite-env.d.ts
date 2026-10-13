/// <reference types="vite/client" />

declare global {
  const __ELECTRON__: boolean;
  const __APP_VERSION__: string;

  interface TreeNode {
    name: string;
    path: string;
    isDir: boolean;
    children?: TreeNode[];
  }

  interface PotreeConversionProgress {
    projectName: string;
    modelPath: string;
    phase: "checking" | "converting" | "validating" | "complete";
    percent: number;
    message: string;
  }

  interface PotreeModelResult {
    modelPath: string;
    metadataUrl: string;
    generated: boolean;
    bounds: PotreeClipBounds;
  }

  interface PotreeClipBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  }

  interface PotreeClipProgress {
    projectName: string;
    modelPath: string;
    phase: "scanning" | "complete";
    percent: number;
    message: string;
  }

  interface PotreeClipResult {
    mapName: string;
    modelPath: string;
    pointCount: number;
  }

  interface MapCoordinateCorrectionProgress {
    projectName: string;
    modelPath: string;
    phase: "preparing" | "transforming" | "annotations" | "potree" | "complete";
    percent: number;
    message: string;
  }

  interface MapCoordinateCorrectionResult {
    mapName: string;
    modelPath: string;
    origin: [number, number, number];
  }

  type ProjectMapPotreeStatus =
    | "missing"
    | "checking"
    | "converting"
    | "validating"
    | "ready"
    | "stale"
    | "error";

  interface ProjectMapPotreeState {
    status: ProjectMapPotreeStatus;
    outputRelativePath: string;
    metadataRelativePath: string;
    updatedAt: string;
    generatedAt?: string;
    error?: string;
    sourceSize?: number;
    sourceMtimeMs?: number;
  }

  interface ProjectManifestAsset {
    id: string;
    name: string;
    relativePath: string;
    createdAt: string;
    updatedAt: string;
    potree?: ProjectMapPotreeState;
    [key: string]: unknown;
  }

  interface ProjectManifest {
    schemaVersion: number;
    project: {
      id: string;
      name: string;
      createdAt: string;
      updatedAt: string;
    };
    layout: {
      version: number;
      dirs: {
        maps: string;
        pointTables: string;
        surveyImages: string;
        [key: string]: string;
      };
    };
    assets: {
      maps: ProjectManifestAsset[];
      pointTables: ProjectManifestAsset[];
      surveyTasks: ProjectManifestAsset[];
    };
  }

  interface ProjectDataCounts {
    stationBindings: number;
    voltages: number;
    bays: number;
    mainDevices: number;
    components: number;
    points: number;
    total: number;
  }

  interface CabinetImagePackageRecord {
    recordKey: string;
    robotCode: string;
    stationName: string;
    stationCode: string;
    areaName: string;
    areaCode: string;
    bayName: string;
    bayCode: string;
    mainDeviceName: string;
    mainDeviceCode: string;
    componentName: string;
    componentCode: string;
    calibrationId: string;
    imageName: string;
    imageSource?: CabinetImageSource;
    imageDataUrl: string;
  }

  interface CabinetImageSource {
    id: string;
    mime: string;
    size: number;
  }

  interface CabinetImagePackageResult {
    success: boolean;
    error?: string;
    packageName?: string;
    packageDir?: string;
    records?: CabinetImagePackageRecord[];
    warnings?: string[];
    annotationsByComponent?: Record<string, any>;
    ocrRowsByComponent?: Record<string, any[]>;
    singlePointsByComponent?: Record<string, any[]>;
    pointVerifiedByComponent?: Record<string, boolean>;
  }

  interface CabinetImageLoadResult {
    success: boolean;
    error?: string;
    dataUrl?: string;
  }

  interface CabinetImageAnnotationSaveResult {
    success: boolean;
    error?: string;
    saved?: boolean;
    deleted?: boolean;
  }

  interface CabinetMainDeviceNameOverrideSaveResult {
    success: boolean;
    error?: string;
    saved?: boolean;
    key?: string;
    name?: string;
  }

  interface CabinetAnnotationParamsExportResult {
    success: boolean;
    error?: string;
    filePath?: string;
    fileName?: string;
    pointCount?: number;
    matchCount?: number;
  }

  interface CabinetPointTableExportResult {
    success: boolean;
    error?: string;
    filePath?: string;
    fileName?: string;
    rowCount?: number;
    pointCount?: number;
    componentCount?: number;
    calibrationCount?: number;
  }

  interface AppWindowState {
    isMaximized: boolean;
    isFullScreen: boolean;
  }

  type DeviceVerificationNodeKind = "region" | "bay" | "mainDevice" | "component" | "point";

  interface DeviceVerificationTreeNode {
    key: string;
    title: string;
    code: string;
    kind: DeviceVerificationNodeKind;
    isLeaf: boolean;
    hasImage: boolean;
    marked?: boolean;
    children?: DeviceVerificationTreeNode[];
  }

  interface DeviceVerificationPackageResult {
    success: boolean;
    hasData?: boolean;
    error?: string;
    sessionId?: string;
    packageName?: string;
    localDir?: string;
    roots?: DeviceVerificationTreeNode[];
    expandedKeys?: string[];
    pointCount?: number;
    imageCount?: number;
  }

  interface DeviceVerificationChildrenResult {
    success: boolean;
    error?: string;
    children?: DeviceVerificationTreeNode[];
  }

  interface DeviceVerificationImageResult {
    success: boolean;
    error?: string;
    fileName?: string;
    dataUrl?: string;
  }

  interface DeviceCorrectionRect {
    x: number;
    y: number;
    size: number;
    imageWidth: number;
    imageHeight: number;
  }

  interface DeviceCorrectionRecord {
    pointCode: string;
    pointName: string;
    rect: DeviceCorrectionRect;
    updatedAt?: string;
  }

  interface DeviceCorrectionResult {
    success: boolean;
    error?: string;
    rect?: DeviceCorrectionRect | null;
  }

  interface DeviceCorrectionExportResult {
    success: boolean;
    error?: string;
    filePath?: string;
    fileName?: string;
    exportedCount?: number;
  }

  interface DevicePointMarkRecord {
    pointCode: string;
    pointName: string;
    marked: boolean;
  }

  interface DevicePointMarkResult {
    success: boolean;
    error?: string;
    marked?: boolean;
  }

  interface DeviceMarkedPointExportResult {
    success: boolean;
    error?: string;
    filePath?: string;
    fileName?: string;
    exportedCount?: number;
  }

  type ExportTaskStatus = "pending" | "running" | "success" | "failed" | "cancelled";

  interface ExportTaskInfo {
    id: string;
    type: string;
    name: string;
    status: ExportTaskStatus;
    progress: number | null;
    message: string;
    outputPath: string;
    outputDir: string;
    fileName: string;
    createdAt: number;
    updatedAt: number;
  }

  interface BackendRequestLog {
    level: "info" | "warn";
    label: string;
    requestId: string;
    url: string;
    attempt: number;
    status?: number;
    elapsedMs?: number;
    message?: string;
  }

  type LocalExportOperation =
    | "project-export-zip"
    | "survey-data"
    | "image-labels"
    | "cabinet-point-table"
    | "cabinet-annotation-params"
    | "device-correction-data"
    | "device-marked-points"
    | "normal-annotations"
    | "inspection-points";

  interface RemoteExportTaskCreateRequest {
    type: "remote-export";
    name: string;
    backendIp: string;
    exportPath: string;
    query?: Record<string, string | number | boolean | null | undefined>;
    destDir: string;
    preferredFileName?: string;
  }

  interface RemoteDownloadTaskCreateRequest {
    type: "remote-download";
    name: string;
    backendIp: string;
    downloadPath: string;
    destDir: string;
    preferredFileName?: string;
  }

  interface LocalExportTaskCreateRequest {
    type: "local-export";
    name: string;
    operation: LocalExportOperation;
    destDir: string;
    payload?: Record<string, unknown>;
  }

  interface LocalExportPrepareRequest {
    operation: LocalExportOperation;
    payload?: Record<string, unknown>;
  }

  type ExportTaskCreateRequest = RemoteExportTaskCreateRequest | RemoteDownloadTaskCreateRequest | LocalExportTaskCreateRequest;

  interface ExportTaskActionResult {
    success: boolean;
    error?: string;
    task?: ExportTaskInfo | null;
  }

  interface Window {
    ZLMRTCClient?: {
      Endpoint: new (options: {
        element: HTMLVideoElement;
        debug?: boolean;
        zlmsdpUrl: string;
        simulecast: boolean;
        useCamera: boolean;
        audioEnable: boolean;
        videoEnable: boolean;
        recvOnly: boolean;
        usedatachannel: boolean;
      }) => {
        on: (event: string, handler: (payload?: unknown) => void) => void;
        close: () => void;
      };
      Events?: Record<string, string>;
    };
    electronAPI?: {
      platform: string;
      appUpdate: {
        state: () => Promise<import("./shared/app-update").AppUpdateState>;
        check: () => Promise<import("./shared/app-update").AppUpdateActionResult>;
        download: () => Promise<import("./shared/app-update").AppUpdateActionResult>;
        install: () => Promise<import("./shared/app-update").AppUpdateActionResult>;
        onChanged: (callback: (state: import("./shared/app-update").AppUpdateState) => void) => () => void;
      };
      minimize: () => void;
      maximize: () => void;
      getWindowState: () => Promise<AppWindowState>;
      onWindowStateChange: (callback: (state: AppWindowState) => void) => () => void;
      close: () => void;
      ping: (ip: string) => Promise<boolean>;
      calibrationGrpc: {
        status: () => Promise<import("./services/calibration-grpc-types").CalibrationGrpcStatus>;
        connect: (robotCode: string, endpoint: import("./services/calibration-grpc-types").CalibrationGrpcEndpoint) => Promise<import("./services/calibration-grpc-types").CalibrationGrpcStatus>;
        disconnect: (robotCode?: string) => Promise<import("./services/calibration-grpc-types").CalibrationGrpcStatus>;
        deliver: (request: import("./services/calibration-grpc-types").CameraCalibrationDeliveryRequest) => Promise<import("./services/calibration-grpc-types").CameraCalibrationDeliveryReply>;
        onChanged: (callback: (status: import("./services/calibration-grpc-types").CalibrationGrpcStatus) => void) => () => void;
      };
      readFileChunk: (path: string, offset: number, length: number) => Promise<ArrayBuffer>;
      readLargeFile: (path: string) => Promise<ArrayBuffer>;
      getFilePath: (file: File) => string;
      downloadRemoteFile: (
        remoteUrl: string,
        preferredFileName: string,
        destDir: string,
      ) => Promise<{ success: boolean; error?: string; filePath?: string; fileName?: string }>;
      downloadTasks: {
        list: () => Promise<ExportTaskInfo[]>;
        prepareLocal: (request: LocalExportPrepareRequest) => Promise<ExportTaskActionResult>;
        create: (request: ExportTaskCreateRequest) => Promise<ExportTaskActionResult>;
        cancel: (taskId: string) => Promise<ExportTaskActionResult>;
        retry: (taskId: string) => Promise<ExportTaskActionResult>;
        openFolder: (taskId: string) => Promise<{ success: boolean; error?: string }>;
        remove: (taskId: string) => Promise<ExportTaskActionResult>;
        onChanged: (callback: (tasks: ExportTaskInfo[]) => void) => () => void;
      };
      onBackendRequestLog: (callback: (log: BackendRequestLog) => void) => () => void;
      project: {
        list: () => Promise<string[]>;
        openDatabase: (projectName: string) => Promise<{ projectName: string; projectId: string; sessionVersion: number }>;
        closeDatabase: () => Promise<void>;
        create: (name: string) => Promise<string>;
        rename: (oldName: string, newName: string) => Promise<string>;
        delete: (name: string) => Promise<string>;
        getDataSummary: (name: string) => Promise<ProjectDataCounts>;
        importFile: (projectName: string, sourcePath: string, fileName: string) => Promise<string>;
        importModelZip: (projectName: string, sourcePath: string) => Promise<{ mapName: string; mapDir: string; modelPath: string }>;
        inspectModelZipImport: (projectName: string, sourcePath: string) => Promise<{ mapCode: string; mapName: string; willReplace: boolean; existingMapName?: string; existingMapDir?: string }>;
        getManifest: (projectName: string) => Promise<ProjectManifest>;
        listTree: (projectName: string, subDir: string) => Promise<TreeNode[]>;
        writeFile: (projectName: string, subPath: string, data: ArrayBuffer) => Promise<string>;
        deletePath: (targetPath: string) => Promise<boolean>;
        renamePath: (targetPath: string, newName: string) => Promise<string>;
        openDir: (targetPath: string) => Promise<void>;
        exportFile: (projectName: string, subPath: string, destDir: string) => Promise<string>;
      };
      potree: {
        ensureModel: (projectName: string, modelPath: string) => Promise<PotreeModelResult>;
        clipModel: (projectName: string, modelPath: string, bounds: PotreeClipBounds) => Promise<PotreeClipResult>;
        correctMap: (projectName: string, modelPath: string, origin: [number, number, number]) => Promise<MapCoordinateCorrectionResult>;
        onConversionProgress: (callback: (progress: PotreeConversionProgress) => void) => () => void;
        onClipProgress: (callback: (progress: PotreeClipProgress) => void) => () => void;
        onCorrectionProgress: (callback: (progress: MapCoordinateCorrectionProgress) => void) => () => void;
      };
      selectDir: (title?: string) => Promise<string | null>;
      selectZipFile: () => Promise<string | null>;
      onExportProgress: (callback: (data: { step: string; pct: number }) => void) => () => void;
      importPoints: (rows: any[], stationName: string, stationCode: string, projectName: string) => Promise<{ total: number; inserted: number; updated: number; errors: string[] }>;
      saveCabinetMainDevices: (
        projectName: string,
        payload: {
          area: { id: number; name: string; code: string };
          bay: { id: number; name: string; code: string };
          rows: { key?: string; code: string; name: string }[];
        },
      ) => Promise<{ inserted: number; updated: number; total: number; ids: number[] }>;
      renameCabinetMainDevices: (projectName: string, rows: { code: string; name: string }[]) => Promise<{ updated: number }>;
      deleteCabinetMainDevices: (
        projectName: string,
        payload: {
          devices?: { code?: string; name?: string }[];
        },
      ) => Promise<{ deleted: number; ids: number[]; unmatched: { code: string; name: string; reason: string }[]; beforeProjectCount: number; afterProjectCount: number }>;
      exportZip: (projectName: string, items: { type: string; name: string }[], destDir: string) => Promise<{ zipPath: string; zipName: string }>;
      extractZip: (zipPath: string, destDir: string) => Promise<{ success: boolean; error?: string; actualDir?: string }>;
      importSurveyData: (projectName: string, mapName: string, zipPath: string) => Promise<{ success: boolean; error?: string; surveyDir?: string; deviceDir?: string; importedSpIds?: number[] }>;
      exportSurveyData: (projectName: string, mapName: string, destDir: string) => Promise<{ success: boolean; error?: string; zipPath?: string; zipName?: string }>;
      exportImageLabels: (projectName: string, mapName: string, destDir: string) => Promise<{ success: boolean; error?: string; zipPath?: string; zipName?: string; exportedCount?: number }>;
      importImageLabels: (projectName: string, mapName: string, zipPath: string) => Promise<{ success: boolean; error?: string; importedCount?: number; warnings?: string[] }>;
      importCabinetImagePackage: (projectName: string, zipPath: string) => Promise<CabinetImagePackageResult>;
      loadLocalCabinetImagePackage: (projectName: string) => Promise<CabinetImagePackageResult>;
      loadCabinetImage: (sourceId: string) => Promise<CabinetImageLoadResult>;
      saveCabinetImageAnnotations: (
        projectName: string,
        payload: {
          recordKey: string;
          robotCode: string;
          componentCode: string;
          annotations: any;
          ocrRows: any[];
          singlePoints: any[];
          pointVerified?: boolean;
        },
      ) => Promise<CabinetImageAnnotationSaveResult>;
      saveCabinetMainDeviceNameOverride: (
        projectName: string,
        payload: {
          key: string;
          robotCode: string;
          name: string;
        },
      ) => Promise<CabinetMainDeviceNameOverrideSaveResult>;
      exportCabinetAnnotationParams: (
        projectName: string,
        destDir: string,
        data: any,
      ) => Promise<CabinetAnnotationParamsExportResult>;
      exportCabinetPointTable: (
        projectName: string,
        destDir: string,
      ) => Promise<CabinetPointTableExportResult>;
      importDeviceVerificationPackage: (projectName: string, sourcePath: string) => Promise<DeviceVerificationPackageResult>;
      loadLocalDeviceVerificationPackage: (projectName: string) => Promise<DeviceVerificationPackageResult>;
      loadDeviceVerificationChildren: (sessionId: string, parentId: string) => Promise<DeviceVerificationChildrenResult>;
      loadDeviceVerificationImage: (sessionId: string, pointNodeId: string) => Promise<DeviceVerificationImageResult>;
      loadDeviceCorrection: (projectName: string, pointCode: string) => Promise<DeviceCorrectionResult>;
      saveDeviceCorrection: (projectName: string, record: DeviceCorrectionRecord) => Promise<DeviceCorrectionResult>;
      deleteDeviceCorrection: (projectName: string, pointCode: string) => Promise<{ success: boolean; error?: string }>;
      exportDeviceCorrectionData: (projectName: string, destDir: string) => Promise<DeviceCorrectionExportResult>;
      setDevicePointMark: (projectName: string, record: DevicePointMarkRecord) => Promise<DevicePointMarkResult>;
      exportMarkedDevicePoints: (projectName: string, destDir: string) => Promise<DeviceMarkedPointExportResult>;
      getProjectRoot: () => Promise<string>;
      setDataPath: (newPath: string) => Promise<{ projectRoot: string; changed: boolean; warning?: string }>;
      getDataPathMigrationStatus: () => Promise<{ pending: boolean; target?: string; phase?: string }>;
      onDataPathMigrationProgress: (callback: (progress: {
        phase: string;
        message: string;
        mode?: "move" | "copy";
        totalFiles: number;
        completedFiles: number;
        totalBytes: number;
        completedBytes: number;
      }) => void) => () => void;
      db: {
        voltage: {
          list: (projectName?: string) => Promise<import('@robot/database').DeviceVoltage[]>;
          getById: (id: number) => Promise<import('@robot/database').DeviceVoltage | null>;
          findByStationId: (stationId: number, projectName?: string) => Promise<import('@robot/database').DeviceVoltage[]>;
          create: (dto: import('@robot/database').CreateDeviceVoltageDTO) => Promise<import('@robot/database').DeviceVoltage>;
          update: (id: number, dto: import('@robot/database').UpdateDeviceVoltageDTO) => Promise<void>;
          delete: (id: number) => Promise<void>;
        };
        bay: {
          list: (projectName?: string) => Promise<import('@robot/database').DeviceBay[]>;
          getById: (id: number) => Promise<import('@robot/database').DeviceBay | null>;
          findByVoltId: (voltId: number, projectName?: string) => Promise<import('@robot/database').DeviceBay[]>;
          findByStationId: (stationId: number, projectName?: string) => Promise<import('@robot/database').DeviceBay[]>;
          create: (dto: import('@robot/database').CreateDeviceBayDTO) => Promise<import('@robot/database').DeviceBay>;
          update: (id: number, dto: import('@robot/database').UpdateDeviceBayDTO) => Promise<void>;
          delete: (id: number) => Promise<void>;
        };
        mainDevice: {
          list: (projectName?: string) => Promise<import('@robot/database').DeviceMain[]>;
          getById: (id: number) => Promise<import('@robot/database').DeviceMain | null>;
          findByBayId: (bayId: number, projectName?: string) => Promise<import('@robot/database').DeviceMain[]>;
          findByStationId: (stationId: number, projectName?: string) => Promise<import('@robot/database').DeviceMain[]>;
          findByMainDeviceNameAndBayId: (mainDeviceName: string, bayId: number, projectName: string) => Promise<import('@robot/database').DeviceMain | null>;
          findByMainDeviceCode: (mainDeviceCode: string, projectName: string) => Promise<import('@robot/database').DeviceMain | null>;
          create: (dto: import('@robot/database').CreateDeviceMainDTO) => Promise<import('@robot/database').DeviceMain>;
          update: (id: number, dto: import('@robot/database').UpdateDeviceMainDTO) => Promise<void>;
          delete: (id: number) => Promise<void>;
          deleteCascade: (id: number, projectName?: string) => Promise<void>;
        };
        component: {
          list: (projectName?: string) => Promise<import('@robot/database').DeviceComponent[]>;
          getById: (id: number) => Promise<import('@robot/database').DeviceComponent | null>;
          findByMainDeviceId: (mainDeviceId: number, projectName?: string) => Promise<import('@robot/database').DeviceComponent[]>;
          findByStationId: (stationId: number, projectName?: string) => Promise<import('@robot/database').DeviceComponent[]>;
          create: (dto: import('@robot/database').CreateDeviceComponentDTO) => Promise<import('@robot/database').DeviceComponent>;
          update: (id: number, dto: import('@robot/database').UpdateDeviceComponentDTO) => Promise<void>;
          delete: (id: number) => Promise<void>;
        };
        point: {
          list: (projectName?: string) => Promise<import('@robot/database').DevicePoint[]>;
          getById: (id: number) => Promise<import('@robot/database').DevicePoint | null>;
          findByPointCode: (pointCode: string, projectName?: string) => Promise<import('@robot/database').DevicePoint | null>;
          findByCalibrationId: (calibrationId: string, projectName?: string) => Promise<import('@robot/database').DevicePoint | null>;
          bindCalibrationId: (pointCode: string, projectName: string) => Promise<string>;
          bindCalibrationIds: (pointCodes: string[], projectName: string) => Promise<import('@robot/database').CalibrationIdBinding[]>;
          clearCalibrationId: (pointCode: string, projectName: string) => Promise<void>;
          clearCalibrationIds: (pointCodes: string[], projectName: string) => Promise<number>;
          findByStationId: (stationId: number, projectName?: string) => Promise<import('@robot/database').DevicePoint[]>;
          findByComponentId: (componentId: number, projectName?: string) => Promise<import('@robot/database').DevicePoint[]>;
          paginate: (page: number, pageSize: number, stationId?: number, projectName?: string) => Promise<{ data: import('@robot/database').DevicePoint[]; total: number }>;
          create: (dto: import('@robot/database').CreateDevicePointDTO) => Promise<import('@robot/database').DevicePoint>;
          update: (id: number, dto: import('@robot/database').UpdateDevicePointDTO) => Promise<void>;
          delete: (id: number) => Promise<void>;
        };
      };
    };
  }
}

export {};
