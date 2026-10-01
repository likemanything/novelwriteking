import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const API = process.env.INKLOOM_API ?? 'http://127.0.0.1:4318';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // 开发时把接口请求转发到本机接口服务（npm run dev 会同时启动它）
    proxy: { '/api': { target: API, changeOrigin: false, ws: false } },
  },
  preview: { host: '127.0.0.1', port: 4173, proxy: { '/api': { target: API } } },
});
