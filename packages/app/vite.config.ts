import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import electron from 'vite-plugin-electron';

export default defineConfig(({ mode }) => {
  const isElectron = process.env.ELECTRON === 'true';
  const isDev = mode === 'development';

  const config: any = {
    base: isElectron ? './' : '/',

    resolve: {
      alias: {
        '@': path.resolve('src'),
        playcanvas: path.resolve(`node_modules/playcanvas/build/playcanvas${isDev ? '.dbg' : ''}/src/index.js`),
        'laz-perf': path.resolve('node_modules/laz-perf/lib/web/index'),
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
            'playcanvas': ['playcanvas'],
            'antd': ['antd', '@ant-design/icons'],
            'splat': ['@playcanvas/splat-transform'],
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
      include: ['mqtt', 'playcanvas', '@playcanvas/splat-transform'],
    },

    plugins: [
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