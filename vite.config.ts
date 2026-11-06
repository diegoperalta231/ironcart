import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Con `npm run dev:front` las llamadas a /api se envían a `netlify dev` (puerto 8888).
  server: { proxy: { '/api': 'http://localhost:8888' } },
  build: { target: 'es2020', sourcemap: false, assetsDir: 'assets' },
});
