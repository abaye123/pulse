import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3100',
      '/auth': 'http://127.0.0.1:3100',
      '/health': 'http://127.0.0.1:3100'
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
