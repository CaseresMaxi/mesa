import type { GamePackInput } from '@mesa/core';

/**
 * De dónde sale el pack:
 * - dev (`pnpm dev`): la API local (`/api/packs/:id`, opcionalmente el borrador del editor) + eventos en vivo (SSE).
 * - build estático: `./pack.json` empaquetado por `scripts/build-all.ts`.
 */
export const DEV = import.meta.env.DEV;

export async function listPacks(): Promise<{ id: string; name: string }[]> {
  if (!DEV) {
    const p = await loadPack();
    return [{ id: p.input.pack.id, name: p.input.pack.name }];
  }
  return (await fetch('/api/packs')).json();
}

export async function loadPack(id?: string, draft = false): Promise<{ input: GamePackInput; draft: boolean }> {
  if (!DEV) return { input: await (await fetch('./pack.json')).json(), draft: false };
  const r = await fetch(`/api/packs/${id}${draft ? '?draft=1' : ''}`);
  if (!r.ok) throw new Error(`No pude cargar el pack ${id}`);
  const j = (await r.json()) as { input: GamePackInput; draft: boolean };
  return { input: j.input, draft: j.draft };
}

/** URL de un archivo propio del pack (assets con `file`). */
export function packFileUrl(id: string, path: string): string {
  return DEV ? `/api/packs/${id}/file?path=${encodeURIComponent(path)}` : `./files/${path}`;
}

/** Avisa cuando cambian los archivos del pack (o su borrador). Sólo en dev. */
export function onPackChange(cb: (e: { pack: string; file: string; draft: boolean }) => void): () => void {
  if (!DEV) return () => {};
  const es = new EventSource('/api/events');
  es.onmessage = (m) => {
    try {
      cb(JSON.parse(m.data));
    } catch {
      /* ignorar */
    }
  };
  return () => es.close();
}
