import { defineConfig } from 'vite';

export default defineConfig({
  base: '/retinal-break-locator/',
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});