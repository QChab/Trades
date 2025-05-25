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
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
      jsbi: 'jsbi/dist/jsbi.mjs'
    }
  },
  optimizeDeps: {
    // esbuild must pre-bundle it so the SDKs see the same instance
    include: ['jsbi']
  }
});