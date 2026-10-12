import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import electron from 'vite-plugin-electron';
import { potreeAssetsPlugin } from './src/potree-core/vite-potree-assets';

const appRoot = fileURLToPath(new URL('.', import.meta.url));
const appVersion = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version;
const devProcessStateDir = path.join(appRoot, 'node_modules', '.cache', 'robot-config-tools', 'dev-processes');

function devProcessTrackerPlugin() {
  return {
    name: 'robot-config-tools-dev-process-tracker',
    apply: 'serve' as const,
    configureServer() {
      const statePath = path.join(devProcessStateDir, `${process.pid}.json`);
      const state = {
        version: 1,
        pid: process.pid,
        startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
        executable: process.execPath,
        appRoot,
      };

      fs.mkdirSync(devProcessStateDir, { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify(state), 'utf8');

      process.once('exit', () => {
        try {
          const current = JSON.parse(fs.readFileSync(statePath, 'utf8'));
          if (current?.pid === process.pid) fs.rmSync(statePath, { force: true });
        } catch {
          // The package preparation step also removes stale state files.
        }
      });
    },
  };
}

export default defineConfig(() => {
  const isElectron = process.env.ELECTRON === 'true';

  const config: any = {
    base: isElectron ? './' : '/',

    resolve: {
      alias: {
        '@': path.resolve(appRoot, 'src'),
        'laz-perf': path.resolve(appRoot, 'node_modules/laz-perf/lib/web/index'),
      },
    },

    css: {
      preprocessorOptions: {
        scss: { silenceDeprecations: ['legacy-js-api'] },
      },
      devSourcemap: true,
    },

    build: {
      target: 'es2022',
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            'antd': ['antd', '@ant-design/icons'],
            'mqtt': ['mqtt'],
          },
        },
      },
    },

    define: {
      __ELECTRON__: JSON.stringify(isElectron),
      __APP_VERSION__: JSON.stringify(appVersion),
    },

    server: {
      port: 50050,
      hmr: { overlay: false },
    },

    optimizeDeps: {
      include: ['mqtt'],
    },

    plugins: [
      devProcessTrackerPlugin(),
      potreeAssetsPlugin({ sourceRoot: path.resolve(appRoot, 'src/potree-core') }),
      react(),
      {
        name: 'svg-data-uri',
        transform(code, id) {
          if (id.endsWith('.svg') && (id.includes('/svg/') || id.includes('\\svg\\'))) {
            const encoded = encodeURIComponent(code);
            return `export default "data:image/svg+xml,${encoded}";`;
          }
        },
      },
    ],
  };

  if (isElectron) {
    config.plugins.push(
      electron([
        {
          entry: 'electron/main.ts',
          vite: {
            define: { __APP_VERSION__: JSON.stringify(appVersion) },
            build: {
              outDir: 'dist-electron',
              rollupOptions: {
                external: ['electron', 'sql.js'],
              },
            },
          },
        },
        {
          entry: 'electron/preload.cjs',
          vite: {
            build: {
              outDir: 'dist-electron',
              rollupOptions: {
                external: ['electron', 'sql.js'],
              },
            },
          },
          onstart(options: any) {
            options.reload();
          },
        },
      ]),
    );
  }

  return config;
});
