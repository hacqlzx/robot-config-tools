/// <reference types="vite/client" />

declare const __ELECTRON__: boolean;

declare global {
  interface Window {
    electronAPI?: {
      platform: string;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      ping: (ip: string) => Promise<boolean>;
      readLargeFile: (path: string) => Promise<ArrayBuffer>;
      getFilePath: (file: File) => string;
    };
  }
}

export {};
