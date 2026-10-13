import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base 使用相对路径，方便部署到任意子路径（如 GitHub Pages / 静态托管）
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
  },
});