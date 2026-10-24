import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // strictPort: a taken port fails loudly instead of drifting into the API's.
  server: { port: 4503, strictPort: true },
  preview: { port: 4511, strictPort: true },
  build: { outDir: 'dist' },
});
