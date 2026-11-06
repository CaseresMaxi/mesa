import { useSyncExternalStore } from 'react';
import { diff, newBatch, patchItemsFromDiff, type Batch, type GamePackInput } from '@mesa/core';
import { api } from './api.ts';

/** Store mínimo del editor (sin dependencias): pack base (disco), borrador, historial, lote y selección. */

export type Tab = 'mapa' | 'facciones' | 'cartas' | 'assets' | 'animaciones' | 'balance' | 'lote' | 'json';
export type Mode = 'directo' | 'lote';

export interface EditorState {
  packs: { id: string; name: string }[];
  packId: string | null;
  base: GamePackInput | null;
  draft: GamePackInput | null;
  past: GamePackInput[];
  future: GamePackInput[];
  mode: Mode;
  tab: Tab;
  batch: Batch | null;
  batchName: string | null;
  selFaction: string | null;
  selNode: number | null;
  toast: { text: string; kind: 'ok' | 'error' } | null;
  busy: boolean;
}

let state: EditorState = {
  packs: [],
  packId: null,
  base: null,
  draft: null,
  past: [],
  future: [],
  mode: 'directo',
  tab: (new URLSearchParams(location.search).get('tab') as Tab) || 'mapa',
  batch: null,
  batchName: null,
  selFaction: null,
  selNode: null,
  toast: null,
  busy: false,
};
const listeners = new Set<() => void>();

export function getState() {
  return state;
}
export function set(patch: Partial<EditorState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export function useStore<T>(sel: (s: EditorState) => T): T {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => sel(state),
  );
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, kind: 'ok' | 'error' = 'ok') {
  set({ toast: { text, kind } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => set({ toast: null }), kind === 'error' ? 6000 : 3000);
}

// ───────────────────────── borrador ─────────────────────────

const MAX_HISTORY = 100;

/** Edita el borrador con una función que muta una copia. Agrupa en el historial. */
export function edit(fn: (d: GamePackInput) => void) {
  if (!state.draft) return;
  const next = structuredClone(state.draft);
  fn(next);
  if (JSON.stringify(next) === JSON.stringify(state.draft)) return;
  set({ draft: next, past: [...state.past.slice(-MAX_HISTORY), state.draft], future: [] });
}

export function replaceDraft(next: GamePackInput) {
  if (!state.draft) return;
  set({ draft: next, past: [...state.past.slice(-MAX_HISTORY), state.draft], future: [] });
}

export function undo() {
  const { past, draft, future } = state;
  if (!past.length || !draft) return;
  set({ draft: past[past.length - 1], past: past.slice(0, -1), future: [draft, ...future] });
}
export function redo() {
  const { past, draft, future } = state;
  if (!future.length || !draft) return;
  set({ draft: future[0], future: future.slice(1), past: [...past, draft] });
}

export function discardDraft() {
  if (!state.base) return;
  replaceDraft(structuredClone(state.base));
}

export function dirtyOps() {
  return state.base && state.draft ? diff(state.base, state.draft) : [];
}

// ───────────────────────── carga / guardado ─────────────────────────

export async function loadPacks() {
  const packs = await api.packs();
  set({ packs });
  const want = new URLSearchParams(location.search).get('pack') ?? localStorage.getItem('mesa.pack') ?? packs[0]?.id;
  if (want && packs.some((p) => p.id === want)) await openPack(want);
  else if (packs[0]) await openPack(packs[0].id);
}

export async function openPack(id: string) {
  set({ busy: true });
  try {
    const { input } = await api.pack(id);
    localStorage.setItem('mesa.pack', id);
    set({
      packId: id,
      base: input,
      draft: structuredClone(input),
      past: [],
      future: [],
      batch: newBatch(id, 'Lote sin título'),
      batchName: null,
      selFaction: (input.factions as { id: string }[])[0]?.id ?? null,
      selNode: null,
    });
  } catch (e) {
    toast(`No pude abrir el pack: ${(e as Error).message}`, 'error');
  } finally {
    set({ busy: false });
  }
}

export async function saveDraft(force = false) {
  const { packId, draft } = state;
  if (!packId || !draft) return;
  set({ busy: true });
  try {
    const r = await api.savePack(packId, draft, force);
    set({ base: structuredClone(draft) });
    toast(r.written.length ? `Guardado: ${r.written.join(', ')}` : 'Sin cambios en disco');
  } catch (e) {
    const err = e as Error & { issues?: unknown[] };
    toast(`${err.message}${err.issues ? ` (${err.issues.length} problemas). Corregí los errores o forzá el guardado.` : ''}`, 'error');
  } finally {
    set({ busy: false });
  }
}

// ───────────────────────── lote ─────────────────────────

export function editBatch(fn: (b: Batch) => void) {
  if (!state.batch) return;
  const b = structuredClone(state.batch);
  fn(b);
  set({ batch: b });
}

/** Convierte el diff base→borrador en items del lote y vuelve el borrador a la base. */
export function diffToBatch(resetDraft = true): number {
  const { base, draft, batch } = state;
  if (!base || !draft || !batch) return 0;
  const items = patchItemsFromDiff(base, draft);
  if (!items.length) return 0;
  editBatch((b) => b.items.push(...items));
  if (resetDraft) set({ draft: structuredClone(base), past: [...state.past, draft], future: [] });
  return items.length;
}
