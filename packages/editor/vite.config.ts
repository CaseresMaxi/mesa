import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { mesaApi } from '@mesa/devserver';

export default defineConfig({
  plugins: [react(), mesaApi()],
  server: { port: 5180 },
  worker: { format: 'es' },
});
