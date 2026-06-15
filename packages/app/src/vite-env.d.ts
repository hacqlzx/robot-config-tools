/// <reference types="vite/client" />

declare global {
  const __ELECTRON__: boolean;

  interface TreeNode {
    name: string;
    path: string;
    isDir: boolean;
    children?: TreeNode[];
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
        listTree: (projectName: string, subDir: string) => Promise<TreeNode[]>;
      };
    };
  }
}

export {};
