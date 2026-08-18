import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'node:url';
import electron from 'vite-plugin-electron';
import { potreeAssetsPlugin } from './src/potree-core/vite-potree-assets';

const appRoot = fileURLToPath(new URL('.', import.meta.url));

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
    },

    server: {
      port: 50050,
      hmr: { overlay: false },
    },

    optimizeDeps: {
      include: ['mqtt'],
    },

    plugins: [
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
