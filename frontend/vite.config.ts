import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8000' } },
  // one JS file (jsPDF's optional html2canvas/dompurify chunks inlined) so the app can be shipped as a single HTML
  build: { outDir: 'dist', chunkSizeWarningLimit: 3000, rollupOptions: { output: { inlineDynamicImports: true } } },
})
