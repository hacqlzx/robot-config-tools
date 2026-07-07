export interface FileSource {
  readChunk(filePath: string, offset: number, length: number): Promise<ArrayBuffer>;
  readAll(filePath: string): Promise<ArrayBuffer>;
}

function ensureElectronApi() {
  if (!window.electronAPI?.readLargeFile) {
    throw new Error("Electron file API is unavailable.");
  }
  return window.electronAPI;
}

export const electronFileSource: FileSource = {
  async readChunk(filePath, offset, length) {
    const api = ensureElectronApi();
    if (api.readFileChunk) {
      return api.readFileChunk(filePath, offset, length);
    }
    const buf = await api.readLargeFile!(filePath);
    return buf.slice(offset, offset + length);
  },

  readAll(filePath) {
    return ensureElectronApi().readLargeFile!(filePath);
  },
};
