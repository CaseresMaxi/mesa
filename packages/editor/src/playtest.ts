import type { GamePackInput } from '@mesa/core';
import { getState, toast } from './state.ts';

/**
 * Probar en el juego: publica el borrador en `packs/<id>/.draft.json` (vía la API) y abre el cliente
 * (`@mesa/play`, http://localhost:5181). Mientras la sincronización está activa, cada edición vuelve a
 * publicar el borrador y el juego se recarga solo re-jugando la partida en curso.
 */
export const PLAY_URL = import.meta.env.VITE_PLAY_URL ?? 'http://localhost:5181';

let live = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let last = '';

async function push(id: string, draft: GamePackInput) {
  const body = JSON.stringify(draft);
  if (body === last) return;
  last = body;
  await fetch(`/api/packs/${id}/draft`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
}

export async function playtest() {
  const { packId, draft } = getState();
  if (!packId || !draft) return;
  await push(packId, draft);
  live = true;
  window.open(`${PLAY_URL}/?pack=${packId}&draft=1`, `mesa-play-${packId}`);
  toast('Borrador publicado: el juego se actualiza en vivo mientras editás');
}

/** Llamar en cada cambio de estado del editor. */
export function syncDraft() {
  if (!live) return;
  const { packId, draft } = getState();
  if (!packId || !draft) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void push(packId, draft).catch(() => {}), 300);
}

export async function stopPlaytest() {
  const { packId } = getState();
  live = false;
  last = '';
  if (packId) await fetch(`/api/packs/${packId}/draft`, { method: 'DELETE' });
}

export const isLive = () => live;
