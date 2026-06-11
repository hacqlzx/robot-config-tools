import { app, BrowserWindow, Menu, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  // 大文件读取（Node.js Buffer 绕开 JS ArrayBuffer 2GB 限制）
  ipcMain.handle('read-large-file', async (_event, filePath: string) => {
    const buffer = await fs.promises.readFile(filePath);
    return buffer.buffer;
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'bottom' });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
