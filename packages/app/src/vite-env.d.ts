/// <reference types="vite/client" />

declare global {
  const __ELECTRON__: boolean;

  interface TreeNode {
    name: string;
    path: string;
    isDir: boolean;
    children?: TreeNode[];
  }

  interface ProjectManifestAsset {
    id: string;
    name: string;
    relativePath: string;
    createdAt: string;
    updatedAt: string;
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

  interface Window {
    electronAPI?: {
      platform: string;
      minimize: () => void;
      maximize: () => void;
      getWindowState: () => Promise<AppWindowState>;
      onWindowStateChange: (callback: (state: AppWindowState) => void) => () => void;
      close: () => void;
      ping: (ip: string) => Promise<boolean>;
      readFileChunk: (path: string, offset: number, length: number) => Promise<ArrayBuffer>;
      readLargeFile: (path: string) => Promise<ArrayBuffer>;
      getFilePath: (file: File) => string;
      project: {
        list: () => Promise<string[]>;
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
        },
      ) => Promise<CabinetImageAnnotationSaveResult>;
      importDeviceVerificationPackage: (projectName: string, sourcePath: string) => Promise<DeviceVerificationPackageResult>;
      loadLocalDeviceVerificationPackage: (projectName: string) => Promise<DeviceVerificationPackageResult>;
      loadDeviceVerificationChildren: (sessionId: string, parentId: string) => Promise<DeviceVerificationChildrenResult>;
      loadDeviceVerificationImage: (sessionId: string, pointNodeId: string) => Promise<DeviceVerificationImageResult>;
      loadDeviceCorrection: (projectName: string, pointCode: string) => Promise<DeviceCorrectionResult>;
      saveDeviceCorrection: (projectName: string, record: DeviceCorrectionRecord) => Promise<DeviceCorrectionResult>;
      deleteDeviceCorrection: (projectName: string, pointCode: string) => Promise<{ success: boolean; error?: string }>;
      setDevicePointMark: (projectName: string, record: DevicePointMarkRecord) => Promise<DevicePointMarkResult>;
      exportMarkedDevicePoints: (projectName: string, destDir: string) => Promise<DeviceMarkedPointExportResult>;
      getProjectRoot: () => Promise<string>;
      setDataPath: (newPath: string) => Promise<boolean>;
      startBatch: () => Promise<void>;
      endBatch: () => Promise<void>;
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
          clearCalibrationId: (pointCode: string, projectName: string) => Promise<void>;
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
