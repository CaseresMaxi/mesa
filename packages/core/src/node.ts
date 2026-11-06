import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { joinFiles, splitPack, type PackFiles } from './pack.ts';
import { PACK_FILES, type GamePackInput, type PackFileKey } from './schema.ts';

/** Utilidades de disco (sólo Node: CLI, tests y el servidor del editor). */

export function findRoot(from = process.cwd()): string {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, 'packs')) && existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const up = dirname(dir);
    if (up === dir) return resolve(from);
    dir = up;
  }
}

/** Acepta un id de pack ("carrera-neural") o una ruta a su carpeta. */
export function packDir(idOrPath: string, root = findRoot()): string {
  if (existsSync(join(idOrPath, 'pack.json'))) return resolve(idOrPath);
  const d = join(root, 'packs', idOrPath);
  if (existsSync(join(d, 'pack.json'))) return d;
  throw new Error(`No encuentro el pack "${idOrPath}" (buscado en ${d})`);
}

export function listPacks(root = findRoot()): string[] {
  const dir = join(root, 'packs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((d) => existsSync(join(dir, d, 'pack.json')));
}

export function readPackFiles(dir: string): PackFiles {
  const out = {} as PackFiles;
  for (const [k, f] of Object.entries(PACK_FILES) as [PackFileKey, string][]) {
    const p = join(dir, f);
    out[k] = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : k === 'assets' ? { entries: [] } : k === 'animations' ? {} : undefined;
  }
  return out;
}

export function loadPackInput(idOrPath: string): GamePackInput {
  return joinFiles(readPackFiles(packDir(idOrPath)));
}

export function writeJson(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

/** Escribe sólo los archivos que cambiaron. Devuelve la lista de archivos escritos. */
export function savePack(dir: string, pack: GamePackInput): string[] {
  const files = splitPack(pack);
  const before = existsSync(join(dir, 'pack.json')) ? readPackFiles(dir) : ({} as PackFiles);
  const written: string[] = [];
  for (const [k, f] of Object.entries(PACK_FILES) as [PackFileKey, string][]) {
    if (files[k] === undefined || JSON.stringify(before[k]) === JSON.stringify(files[k])) continue;
    writeJson(join(dir, f), files[k]);
    written.push(f);
  }
  return written;
}
