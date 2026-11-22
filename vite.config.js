import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 预览 UI 时把 RPC 代理到正在运行的 DSH Web（`DSH_WEB_ORIGIN` 可覆盖）。
const dshOrigin = process.env.DSH_WEB_ORIGIN || 'http://127.0.0.1:62427'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/dsh-csmm/rpc': dshOrigin,
    },
  },
})
