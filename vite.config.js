import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base: the packaged app is loaded from capacitor://localhost, not
  // from a server root.
  base: './',
  // The dev server is the desktop preview harness only.
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // No source maps in the distributable.
    sourcemap: false,
    target: 'es2022',
    assetsInlineLimit: 0
  }
});
