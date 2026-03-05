import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const isLitegraphEvalWarning = (warning: { code?: string; id?: string; message?: string }): boolean => {
  if (warning.code !== 'EVAL') return false;
  const location = `${warning.id || ''} ${warning.message || ''}`.toLowerCase();
  return location.includes('litegraph.js');
};

export default defineConfig({
  plugins: [react()],
  root: path.join(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: path.join(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./src/renderer/index.html', import.meta.url)),
        nodeEditor: fileURLToPath(new URL('./src/renderer/node-editor.html', import.meta.url)),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/litegraph.js')) return 'quest-litegraph';
          if (id.includes('node_modules/reactflow') || id.includes('node_modules/dagre')) return 'quest-graph';
          if (id.includes('node_modules/@mui/icons-material')) return 'mui-icons';
          return undefined;
        },
      },
      onwarn(warning, warn) {
        if (isLitegraphEvalWarning(warning)) {
          return;
        }
        warn(warning);
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
