import { app, BrowserWindow, Menu, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 项目存储根目录：开发时指向 monorepo 根下的 project/，生产时指向 userData 下的 project/
const PROJECT_ROOT = app.isPackaged
  ? path.join(app.getPath('userData'), 'project')
  : path.resolve(__dirname, '..', '..', '..', 'project');

Menu.setApplicationMenu(null);

// 开发环境忽略证书，生产环境按需放行
if (!app.isPackaged) {
  app.commandLine.appendSwitch('ignore-certificate-errors');
}
app.on('certificate-error', (event, _webContents, _url, _error, _certificate, callback) => {
  // 生产环境放行自签名证书（可按需加指纹校验）
  event.preventDefault();
  callback(true);
});

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');
  console.log('preload path:', preloadPath, 'exists:', fs.existsSync(preloadPath));

  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    frame: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      webgl: true,
      webSecurity: false,
    },
  });

  // 窗口控制
  ipcMain.on('win:minimize', () => win.minimize());
  ipcMain.on('win:maximize', () => {
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.on('win:close', () => win.close());

  // ping 检测
  ipcMain.handle('ping', async (_event, ip: string) => {
    const cmd = process.platform === 'win32' ? `ping -n 1 -w 2000 ${ip}` : `ping -c 1 -W 2 ${ip}`;
    return new Promise((resolve) => {
      exec(cmd, (error) => {
        resolve(!error);
      });
    });
  });

  // 大文件分块读取
  ipcMain.handle('read-file-chunk', async (_event, filePath: string, offset: number, length: number) => {
    const fd = await fs.promises.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fd.read(buf, 0, length, offset);
      return buf.buffer.slice(0, bytesRead);
    } finally {
      await fd.close();
    }
  });

  // 大文件整读（<2GB 用 fs.readFile，>=2GB 用分块组装）
  ipcMain.handle('read-large-file', async (_event, filePath: string) => {
    const { size } = await fs.promises.stat(filePath);
    if (size < 2 * 1024 * 1024 * 1024) {
      const buffer = await fs.promises.readFile(filePath);
      return buffer.buffer;
    }
    // >=2GB：分块读取组装（Node.js Buffer 可超 2GB）
    const fd = await fs.promises.open(filePath, 'r');
    try {
      const buf = Buffer.allocUnsafe(size);
      let offset = 0;
      const chunkSize = 512 * 1024 * 1024;
      while (offset < size) {
        const toRead = Math.min(chunkSize, size - offset);
        const { bytesRead } = await fd.read(buf, offset, toRead, offset);
        offset += bytesRead;
      }
      return buf.buffer;
    } finally {
      await fd.close();
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'bottom' });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// === 项目文件夹管理 ===
function ensureProjectRoot() {
  if (!fs.existsSync(PROJECT_ROOT)) {
    fs.mkdirSync(PROJECT_ROOT, { recursive: true });
  }
}

ipcMain.handle('project:list', async () => {
  ensureProjectRoot();
  const entries = fs.readdirSync(PROJECT_ROOT, { withFileTypes: true });
  return entries
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
});

ipcMain.handle('project:create', async (_event, name: string) => {
  ensureProjectRoot();
  const dirPath = path.join(PROJECT_ROOT, name);
  if (fs.existsSync(dirPath)) {
    throw new Error(`项目 "${name}" 已存在`);
  }
  fs.mkdirSync(dirPath);
  return name;
});

ipcMain.handle('project:rename', async (_event, oldName: string, newName: string) => {
  ensureProjectRoot();
  const oldPath = path.join(PROJECT_ROOT, oldName);
  const newPath = path.join(PROJECT_ROOT, newName);
  if (!fs.existsSync(oldPath)) {
    throw new Error(`项目 "${oldName}" 不存在`);
  }
  if (fs.existsSync(newPath)) {
    throw new Error(`项目 "${newName}" 已存在`);
  }
  fs.renameSync(oldPath, newPath);
  return newName;
});

ipcMain.handle('project:delete', async (_event, name: string) => {
  ensureProjectRoot();
  const dirPath = path.join(PROJECT_ROOT, name);
  if (!fs.existsSync(dirPath)) {
    throw new Error(`项目 "${name}" 不存在`);
  }
  fs.rmSync(dirPath, { recursive: true });
  return name;
});

// 导入模型文件到项目：复制到 project/{projectName}/地图/{fileName}/{fileName}.las
ipcMain.handle('project:import-file', async (_event, projectName: string, sourcePath: string, fileName: string) => {
  ensureProjectRoot();
  const mapDir = path.join(PROJECT_ROOT, projectName, '地图');
  const targetDir = path.join(mapDir, fileName);
  const targetPath = path.join(targetDir, `${fileName}.las`);
  if (!fs.existsSync(mapDir)) {
    fs.mkdirSync(mapDir, { recursive: true });
  }
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  await fs.promises.copyFile(sourcePath, targetPath);
  return targetPath;
});

// 列出项目目录下的文件树
interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
}

function readDirTree(dirPath: string): TreeNode[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true }).map((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      return { name: entry.name, path: fullPath, isDir: true, children: readDirTree(fullPath) };
    }
    return { name: entry.name, path: fullPath, isDir: false };
  });
}

ipcMain.handle('project:list-tree', async (_event, projectName: string, subDir: string) => {
  ensureProjectRoot();
  const targetDir = path.join(PROJECT_ROOT, projectName, subDir);
  return readDirTree(targetDir);
});

// 写入文件到项目目录
ipcMain.handle('project:write-file', async (_event, projectName: string, subPath: string, data: ArrayBuffer) => {
  ensureProjectRoot();
  const filePath = path.join(PROJECT_ROOT, projectName, subPath);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const buf = Buffer.from(data);
  await fs.promises.writeFile(filePath, buf);
  return filePath;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
