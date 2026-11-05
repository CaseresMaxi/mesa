import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, watch } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';
import { Batch, validatePack } from '@mesa/core';
import { findRoot, listPacks, loadPackInput, packDir, readPackFiles, savePack, writeJson } from '@mesa/core/node';

/**
 * API local de desarrollo (la usan el editor y el cliente de juego): packs, borradores, lotes, reportes,
 * archivos y eventos en vivo (SSE). Los borradores viven en `packs/<id>/.draft.json` (gitignored) para que
 * el editor y el juego —dos servidores distintos— vean lo mismo.
 */

function send(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
}

const SAFE_NAME = /^[a-z0-9][a-z0-9._-]*$/i;
const MIME: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json' };

function listJson(dir: string) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: f, name: f.replace(/\.json$/, ''), data: JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>, mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

async function handle(req: IncomingMessage, res: ServerResponse, root: string): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://x');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'api' && parts[1] === 'events') return events(req, res), true;
  if (parts[0] !== 'api' || parts[1] !== 'packs') return false;
  const method = req.method ?? 'GET';
  const id = parts[2];

  if (!id) {
    return send(res, 200, listPacks(root).map((p) => ({ id: p, name: (readPackFiles(packDir(p, root)).pack as { name?: string })?.name ?? p }))), true;
  }
  if (!SAFE_NAME.test(id)) return send(res, 400, { error: 'id inválido' }), true;
  const dir = packDir(id, root);
  const sub = parts[3];

  const draftFile = join(dir, '.draft.json');
  if (!sub) {
    if (method === 'GET') {
      const useDraft = url.searchParams.get('draft') === '1' && existsSync(draftFile);
      const input = useDraft ? JSON.parse(readFileSync(draftFile, 'utf8')) : loadPackInput(dir);
      return send(res, 200, { input, issues: validatePack(input).issues, draft: useDraft }), true;
    }
    if (method === 'PUT') {
      const input = (await body(req)) as Parameters<typeof savePack>[1];
      const { issues } = validatePack(input);
      const errors = issues.filter((i) => i.level === 'error');
      if (errors.length && url.searchParams.get('force') !== '1') return send(res, 400, { error: 'Pack con errores', issues }), true;
      return send(res, 200, { written: savePack(dir, input), issues }), true;
    }
  }

  if (sub === 'draft') {
    if (method === 'PUT') {
      writeJson(draftFile, await body(req));
      return send(res, 200, { ok: true }), true;
    }
    if (method === 'DELETE') {
      if (existsSync(draftFile)) rmSync(draftFile);
      return send(res, 200, { ok: true }), true;
    }
    return send(res, 200, { exists: existsSync(draftFile) }), true;
  }

  if (sub === 'batches' || sub === 'reports') {
    const folder = join(dir, sub);
    const name = parts[4];
    if (!name) {
      if (method !== 'GET') return send(res, 405, { error: 'método' }), true;
      const items = listJson(folder).map(({ name: n, data, mtime }) =>
        sub === 'batches'
          ? { name: n, title: data.title ?? n, items: (data.items as unknown[] | undefined)?.length ?? 0, pending: ((data.items as { status?: string }[] | undefined) ?? []).filter((i) => (i.status ?? 'pending') === 'pending').length, mtime }
          : { name: n, games: data.games, mtime },
      );
      return send(res, 200, items), true;
    }
    if (!SAFE_NAME.test(name)) return send(res, 400, { error: 'nombre inválido' }), true;
    const file = join(folder, `${name}.json`);
    if (method === 'GET') {
      if (!existsSync(file)) return send(res, 404, { error: 'no existe' }), true;
      return send(res, 200, JSON.parse(readFileSync(file, 'utf8'))), true;
    }
    if (method === 'PUT') {
      const data = await body(req);
      if (sub === 'batches') {
        const r = Batch.safeParse(data);
        if (!r.success) return send(res, 400, { error: 'Lote inválido', issues: r.error.issues.map((i) => ({ level: 'error', path: '/' + i.path.join('/'), message: i.message })) }), true;
      }
      mkdirSync(folder, { recursive: true });
      writeJson(file, data);
      return send(res, 200, { ok: true, path: `packs/${id}/${sub}/${name}.json` }), true;
    }
    if (method === 'DELETE') {
      if (existsSync(file)) rmSync(file);
      return send(res, 200, { ok: true }), true;
    }
  }

  if (sub === 'file' && method === 'GET') {
    const rel = url.searchParams.get('path') ?? '';
    const full = resolve(dir, rel);
    if (!full.startsWith(resolve(dir) + sep) || !existsSync(full)) return send(res, 404, { error: 'no existe' }), true;
    res.setHeader('Content-Type', MIME[extname(full).toLowerCase()] ?? 'application/octet-stream');
    res.end(readFileSync(full));
    return true;
  }
  return send(res, 404, { error: 'ruta desconocida' }), true;
}

// ───────────────────────── eventos en vivo ─────────────────────────

export interface PackEvent {
  type: 'pack-changed';
  pack: string;
  /** Archivo relativo al pack (ej. "factions.json", ".draft.json"). */
  file: string;
  draft: boolean;
}

const clients = new Set<ServerResponse>();

function events(req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(': ok\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

function broadcast(e: PackEvent) {
  const data = `data: ${JSON.stringify(e)}\n\n`;
  for (const c of clients) c.write(data);
}

let watching = false;
/** Observa packs/ y avisa por SSE (debounce por archivo). Ignora assets generados, reportes y lotes. */
function watchPacks(root: string) {
  if (watching) return;
  watching = true;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  try {
    watch(join(root, 'packs'), { recursive: true }, (_ev, filename) => {
      if (!filename) return;
      const [pack, ...rest] = filename.split(sep);
      const file = rest.join('/');
      if (!file.endsWith('.json') || /^(reports|batches|assets\/generated)\//.test(file)) return;
      const key = `${pack}/${file}`;
      clearTimeout(timers.get(key));
      timers.set(key, setTimeout(() => broadcast({ type: 'pack-changed', pack, file, draft: file === '.draft.json' }), 120));
    });
  } catch (e) {
    console.warn('[mesa] no se pudo observar packs/:', (e as Error).message);
  }
}

/** Plugin de Vite: monta la API en /api y observa packs/. */
export function mesaApi(): Plugin {
  const root = findRoot(resolve(import.meta.dirname, '../../..'));
  return {
    name: 'mesa-api',
    configureServer(server) {
      watchPacks(root);
      server.middlewares.use((req, res, next) => {
        handle(req, res, root)
          .then((done) => done || next())
          .catch((e: Error) => send(res, 500, { error: e.message }));
      });
    },
  };
}
