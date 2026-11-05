import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { mesaApi } from '@mesa/devserver';
import { embedPack } from './scripts/embed-pack.ts';

/**
 * dev: API local + eventos en vivo (mismo plugin que el editor) en http://localhost:5181
 * build: `MESA_PACK=<id>` empaqueta ese pack (pack.json + archivos propios) en dist/<id>/
 */
const pack = process.env.MESA_PACK;

export default defineConfig({
  base: './',
  plugins: [react(), mesaApi(), ...(pack ? [embedPack(pack)] : [])],
  server: { port: 5181 },
  build: { outDir: pack ? `dist/${pack}` : 'dist', emptyOutDir: true },
});
