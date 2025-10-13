import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  root: './src/renderer',
  base: './',
  build: {
    outDir: '../../vue-dist',
    emptyOutDir: true,
    sourcemap: true,
       // 🛠 Tell esbuild to emit code for modern engines:
    target: 'es2022',       // or ['chrome91','edge91','safari15.4']
    // ensure it outputs ESM, not CJS:
    format: 'esm',
    rollupOptions: {
      external: [
        // Exclude Node.js-only modules used in test files
        'module',
        'url',
        'path',
        'fs'
      ],
      // Exclude test files and Node.js-only utilities from build
      input: {
        main: './src/renderer/index.html'
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
      jsbi: 'jsbi/dist/jsbi.mjs'
    }
  },
  compilerOptions: {
    "target": "es2022",              // or "esnext"
    "module": "esnext",              // ensure ESM output
    "lib": ["es2022", "dom"],        // dom for window.electronAPI
    "moduleResolution": "node",
  },
  optimizeDeps: {
    // esbuild must pre-bundle it so the SDKs see the same instance
    include: ['jsbi']
  }
});