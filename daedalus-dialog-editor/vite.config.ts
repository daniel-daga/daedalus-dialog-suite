import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

export default defineConfig({
  plugins: [react()],
  root: path.join(__dirname, 'src/renderer'),
  base: './',
  optimizeDeps: {
    include: [
      'zustand/shallow',
    ],
  },
  build: {
    outDir: path.join(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./src/renderer/index.html', import.meta.url)),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@mui/icons-material')) return 'mui-icons';
          // With the node-editor entry gone there is no second entry point to
          // make Vite split shared vendor code automatically; carve MUI out of
          // the main chunk to stay under the CI chunk-size guard.
          if (id.includes('node_modules/@mui/')) return 'mui';
          if (id.includes('node_modules/@emotion/')) return 'emotion';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
  },
  resolve: {
    alias: {
      '@': path.join(__dirname, 'src/renderer'),
    },
  },
});
