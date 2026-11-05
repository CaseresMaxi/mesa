import type { Batch, GamePackInput, Issue, SimReport } from '@mesa/core';

/** Cliente de la API local del editor (servidor de Vite, ver server/api.ts). */

async function req<T>(method: string, url: string, data?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: data !== undefined ? { 'Content-Type': 'application/json' } : {}, body: data !== undefined ? JSON.stringify(data) : undefined });
  const json = (await r.json().catch(() => ({}))) as T & { error?: string; issues?: Issue[] };
  if (!r.ok) {
    const err = new Error(json.error ?? `HTTP ${r.status}`) as Error & { issues?: Issue[] };
    err.issues = json.issues;
    throw err;
  }
  return json;
}

export interface BatchSummary {
  name: string;
  title: string;
  items: number;
  pending: number;
}

export const api = {
  packs: () => req<{ id: string; name: string }[]>('GET', '/api/packs'),
  pack: (id: string) => req<{ input: GamePackInput; issues: Issue[] }>('GET', `/api/packs/${id}`),
  savePack: (id: string, input: GamePackInput, force = false) => req<{ written: string[]; issues: Issue[] }>('PUT', `/api/packs/${id}${force ? '?force=1' : ''}`, input),
  batches: (id: string) => req<BatchSummary[]>('GET', `/api/packs/${id}/batches`),
  batch: (id: string, name: string) => req<Batch>('GET', `/api/packs/${id}/batches/${name}`),
  saveBatch: (id: string, name: string, b: Batch) => req<{ path: string }>('PUT', `/api/packs/${id}/batches/${name}`, b),
  deleteBatch: (id: string, name: string) => req<{ ok: true }>('DELETE', `/api/packs/${id}/batches/${name}`),
  reports: (id: string) => req<{ name: string; games: number }[]>('GET', `/api/packs/${id}/reports`),
  report: (id: string, name: string) => req<SimReport>('GET', `/api/packs/${id}/reports/${name}`),
  saveReport: (id: string, name: string, r: SimReport) => req<{ path: string }>('PUT', `/api/packs/${id}/reports/${name}`, r),
  fileUrl: (id: string, path: string) => `/api/packs/${id}/file?path=${encodeURIComponent(path)}`,
};

export function slug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'lote'
  );
}

export function download(name: string, content: string, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
