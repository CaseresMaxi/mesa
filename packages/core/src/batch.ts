import { applyPatch, describeOp, diff } from './paths.ts';
import { Batch, type BatchItem, type GamePackInput, type PatchOp } from './schema.ts';

/** Lotes: cambios preparados en el editor (patches concretos + intenciones para la IA). */

export function newBatch(pack: string, title: string): Batch {
  return { $schema: '../../../schemas/batch.schema.json', format: 'mesa-batch', version: 1, pack, title, createdAt: new Date().toISOString(), notes: '', items: [] };
}

let counter = 0;
export function itemId(prefix = 'it'): string {
  return `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;
}

/** Agrupa el diff base→draft en items de patch: uno por raíz (facción, nodo, archivo). */
export function patchItemsFromDiff(base: unknown, draft: unknown): BatchItem[] {
  const ops = diff(base, draft);
  const groups = new Map<string, PatchOp[]>();
  for (const op of ops) {
    const segs = op.path.split('/').slice(1);
    const key = segs[0] === 'factions' || (segs[0] === 'map' && segs[1] === 'nodes') ? segs.slice(0, segs[0] === 'map' ? 3 : 2).join('/') : segs[0];
    groups.set(key, [...(groups.get(key) ?? []), op]);
  }
  return [...groups.entries()].map(([key, ops]) => ({
    id: itemId('patch'),
    kind: 'patch' as const,
    title: `Ajustes en /${key}`,
    note: ops.map(describeOp).join('\n'),
    ops,
    status: 'pending' as const,
  }));
}

export interface BatchApplyResult {
  pack: GamePackInput;
  applied: string[];
  failed: { id: string; error: string }[];
  /** Intenciones pendientes: las resuelve la IA (skill aplicar-lote). */
  intents: Extract<BatchItem, { kind: 'intent' }>[];
}

/** Aplica los patches pendientes del lote (en orden). Las intenciones quedan para la IA. */
export function applyBatch(pack: GamePackInput, batchInput: unknown, opts: { only?: string[] } = {}): BatchApplyResult {
  const batch = Batch.parse(batchInput);
  let cur = pack;
  const applied: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const it of batch.items) {
    if (it.kind !== 'patch' || it.status !== 'pending') continue;
    if (opts.only && !opts.only.includes(it.id)) continue;
    try {
      cur = applyPatch(cur, it.ops);
      applied.push(it.id);
    } catch (e) {
      failed.push({ id: it.id, error: (e as Error).message });
    }
  }
  return { pack: cur, applied, failed, intents: batch.items.filter((i): i is Extract<BatchItem, { kind: 'intent' }> => i.kind === 'intent' && i.status === 'pending') };
}
