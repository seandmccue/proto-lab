import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Three.js and React change rarely: keep them in their own chunks so a redeploy of app code stays small and cached vendors load in parallel.
    rollupOptions: { output: { manualChunks: { three: ['three', '@react-three/fiber', '@react-three/drei'], react: ['react', 'react-dom', 'react-router-dom'] } } },
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/store': 'http://localhost:8787',
    },
  },
});
