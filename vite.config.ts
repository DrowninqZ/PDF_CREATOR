import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

// base 使用相对路径，方便部署到任意子路径（如 GitHub Pages / 静态托管）
export default defineConfig({
  base: './',
  plugins: [react()],
  // 把 package.json 的版本号注入前端，页面头部展示，便于确认线上运行的是哪个版本
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
  },
});