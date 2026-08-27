import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

/**
 * Serve and ship Monaco from the app's own origin.
 *
 * `@monaco-editor/react` otherwise pulls Monaco off the jsdelivr CDN at
 * runtime, which the renderer's `default-src 'self'` CSP forbids (and which
 * makes the source view need the network). Monaco's `min/vs` AMD tree is far
 * over the 500 kB chunk-size guard, and bundling it — even behind React.lazy —
 * only moves that over-size chunk rather than removing it, so it is copied as
 * static assets instead of going through Rollup at all.
 *
 * Dev serves it straight out of node_modules; the build copies it next to the
 * renderer output, where electron-builder's `dist/renderer/**` rule packages it.
 */
function monacoLocalAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const vsDir = path.join(path.dirname(require.resolve('monaco-editor/package.json')), 'min/vs');
  const PREFIX = '/monaco/vs/';

  return {
    name: 'monaco-local-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0];
        if (!url?.startsWith(PREFIX)) return next();
        // Contain the join to vsDir: the path is attacker-influenced only by
        // the local dev server's own client, but a traversal here would serve
        // arbitrary files off disk.
        const target = path.join(vsDir, url.slice(PREFIX.length));
        if (!target.startsWith(vsDir) || !fs.existsSync(target)) return next();
        const type = target.endsWith('.css') ? 'text/css'
          : target.endsWith('.js') ? 'text/javascript'
          : target.endsWith('.ttf') ? 'font/ttf'
          : 'application/octet-stream';
        res.setHeader('Content-Type', type);
        fs.createReadStream(target).pipe(res);
      });
    },
    closeBundle() {
      const outDir = path.join(__dirname, 'dist/renderer/monaco/vs');
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.cpSync(vsDir, outDir, { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), monacoLocalAssets()],
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
    // Raised from Vite's 500 kB default for exactly one chunk: three.js is
    // 517 kB minified and does not get smaller — `WebGLRenderer` pulls in the
    // whole shader library, and that is the thing the World surface exists to
    // use. CI fails the build on any chunk-size warning, so the alternative to
    // this number is silencing the check for every chunk.
    //
    // The guard keeps doing its job: it was written to stop the main chunk
    // growing (398 kB) and to keep MUI carved out (468 kB), and both are still
    // well under. Raise this again only for a dependency that is genuinely
    // irreducible, and say which one.
    chunkSizeWarningLimit: 550,
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
          // The World surface's renderer stack. Carved out for the same reason
          // MUI is: bundled into the lazy WorldSurface chunk it puts that chunk
          // over the CI chunk-size guard. It is still only fetched when the
          // World view is opened — the chunk hangs off that lazy import.
          if (id.includes('node_modules/three-mesh-bvh/')) return 'three-bvh';
          if (id.includes('node_modules/three/')) return 'three';
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
