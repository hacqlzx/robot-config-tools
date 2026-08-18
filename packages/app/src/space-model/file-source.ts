/**
 * 三维组件的文件读取边界。
 *
 * PointCloudLoader / DrawingRenderer 只关心“按路径读取二进制数据”，不应直接知道
 * Electron IPC、项目目录、权限校验等业务细节。后续如果要把大文件读取挪到 Worker、
 * 做分块缓存、或给浏览器 demo 注入 fetch/blob 读取，只需要实现这个接口。
 */
export interface FileSource {
  /** 读取文件的一段连续字节，LAS 流式加载会频繁调用这里。 */
  readChunk(filePath: string, offset: number, length: number): Promise<ArrayBuffer>;
  /** 一次性读取完整文件，适合 LAZ 解压、绘制 JSON 等无法按块消费的场景。 */
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
    // 优先走主进程的分块读取，避免 LAS 大文件被一次性拉进渲染进程内存。
    if (api.readFileChunk) {
      return api.readFileChunk(filePath, offset, length);
    }
    // 兼容没有分块 API 的运行环境；生产路径应尽量避免落到这个分支。
    const buf = await api.readLargeFile!(filePath);
    return buf.slice(offset, offset + length);
  },

  readAll(filePath) {
    return ensureElectronApi().readLargeFile!(filePath);
  },
};
