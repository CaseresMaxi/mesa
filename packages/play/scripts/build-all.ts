import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { listPacks, loadPackInput } from '@mesa/core/node';

/**
 * Build estático de todos los packs (o de los pasados por argumento): dist/<pack>/ + dist/index.html.
 * Cada carpeta es un sitio independiente (GitHub Pages, Netlify…): `node scripts/build-all.ts [pack…]`.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : listPacks();
const done: { id: string; name: string; description: string }[] = [];
for (const id of ids) {
  process.env.MESA_PACK = id;
  await build({ root, configFile: join(root, 'vite.config.ts'), logLevel: 'warn' });
  const p = loadPackInput(id).pack as { name: string; description?: string };
  done.push({ id, name: p.name, description: p.description ?? '' });
  console.log(`✓ dist/${id}`);
}
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(
  join(root, 'dist', 'index.html'),
  `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>mesa · juegos</title>
<style>body{font-family:system-ui;background:#f4ead2;color:#2b2118;max-width:720px;margin:40px auto;padding:0 16px}a{color:#8a3b1d;font-size:1.3em}li{margin:14px 0}</style>
<h1>Juegos</h1><ul>${done.map((d) => `<li><a href="./${d.id}/">${d.name}</a><br><small>${d.description}</small></li>`).join('')}</ul></html>`,
);
console.log('✓ dist/index.html');
