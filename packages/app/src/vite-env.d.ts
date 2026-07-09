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

  interface Window {
    electronAPI?: {
      platform: string;
      minimize: () => void;
      maximize: () => void;
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
        importFile: (projectName: string, sourcePath: string, fileName: string) => Promise<string>;
        getManifest: (projectName: string) => Promise<ProjectManifest>;
        listTree: (projectName: string, subDir: string) => Promise<TreeNode[]>;
        writeFile: (projectName: string, subPath: string, data: ArrayBuffer) => Promise<string>;
        deletePath: (targetPath: string) => Promise<boolean>;
        renamePath: (targetPath: string, newName: string) => Promise<string>;
        openDir: (targetPath: string) => Promise<void>;
        exportFile: (projectName: string, subPath: string, destDir: string) => Promise<string>;
      };
      selectDir: () => Promise<string | null>;
      selectZipFile: () => Promise<string | null>;
      onExportProgress: (callback: (data: { step: string; pct: number }) => void) => () => void;
      importPoints: (rows: any[], stationName: string, stationCode: string, projectName: string) => Promise<{ total: number; inserted: number; updated: number; errors: string[] }>;
      exportZip: (projectName: string, items: { type: string; name: string }[], destDir: string) => Promise<{ zipPath: string; zipName: string; config: any }>;
      extractZip: (zipPath: string, destDir: string) => Promise<{ success: boolean; error?: string; actualDir?: string }>;
      importSurveyData: (projectName: string, mapName: string, zipPath: string) => Promise<{ success: boolean; error?: string; surveyDir?: string; deviceDir?: string; importedSpIds?: number[] }>;
      exportSurveyData: (projectName: string, mapName: string, destDir: string) => Promise<{ success: boolean; error?: string; zipPath?: string; zipName?: string }>;
      exportImageLabels: (projectName: string, mapName: string, destDir: string) => Promise<{ success: boolean; error?: string; zipPath?: string; zipName?: string; exportedCount?: number }>;
      importImageLabels: (projectName: string, mapName: string, zipPath: string) => Promise<{ success: boolean; error?: string; importedCount?: number; warnings?: string[] }>;
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
          create: (dto: import('@robot/database').CreateDeviceMainDTO) => Promise<import('@robot/database').DeviceMain>;
          update: (id: number, dto: import('@robot/database').UpdateDeviceMainDTO) => Promise<void>;
          delete: (id: number) => Promise<void>;
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
