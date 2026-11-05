import type { PatchOp } from './schema.ts';

/**
 * Rutas "por id" sobre el pack: como JSON Pointer, pero en listas de objetos con `id`
 * el segmento puede ser el id del elemento. Ej.: `/factions/google/battle/maxDice`,
 * `/map/nodes/3/slots`, `/cards/deck/0/count`. `-` al final de un `add` agrega a la lista.
 */

type Json = unknown;

export function splitPath(path: string): string[] {
  if (path === '' || path === '/') return [];
  if (!path.startsWith('/')) throw new Error(`Ruta inválida (debe empezar con /): ${path}`);
  return path
    .slice(1)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function joinPath(segs: (string | number)[]): string {
  return '/' + segs.map((s) => String(s).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}

function indexIn(arr: Json[], seg: string): number {
  const byId = arr.findIndex((e) => e !== null && typeof e === 'object' && 'id' in (e as object) && String((e as { id: unknown }).id) === seg);
  if (byId >= 0) return byId;
  if (/^\d+$/.test(seg)) {
    const i = Number(seg);
    if (i < arr.length) return i;
  }
  return -1;
}

function step(cur: Json, seg: string, path: string): Json {
  if (Array.isArray(cur)) {
    const i = indexIn(cur, seg);
    if (i < 0) throw new Error(`No existe "${seg}" en ${path}`);
    return cur[i];
  }
  if (cur !== null && typeof cur === 'object') {
    if (!(seg in (cur as object))) throw new Error(`No existe "${seg}" en ${path}`);
    return (cur as Record<string, Json>)[seg];
  }
  throw new Error(`No se puede entrar en "${seg}" (${path})`);
}

export function getPath(root: Json, path: string): Json {
  let cur = root;
  for (const seg of splitPath(path)) cur = step(cur, seg, path);
  return cur;
}

export function hasPath(root: Json, path: string): boolean {
  try {
    getPath(root, path);
    return true;
  } catch {
    return false;
  }
}

/** Aplica ops (mutando una copia) y devuelve el resultado. Tira error con la op que falló. */
export function applyPatch<T>(root: T, ops: PatchOp[]): T {
  const out = structuredClone(root) as Json;
  for (const [n, op] of ops.entries()) {
    try {
      const segs = splitPath(op.path);
      if (!segs.length) throw new Error('No se puede reemplazar la raíz');
      const last = segs.pop()!;
      const parent = segs.reduce((cur, seg) => step(cur, seg, op.path), out);
      if (Array.isArray(parent)) {
        if (op.op === 'add') {
          if (last === '-') parent.push(structuredClone(op.value));
          else {
            const i = Number(last);
            if (!Number.isInteger(i) || i > parent.length) throw new Error(`Índice inválido ${last}`);
            parent.splice(i, 0, structuredClone(op.value));
          }
        } else {
          const i = indexIn(parent, last);
          if (i < 0) throw new Error(`No existe "${last}"`);
          if (op.op === 'remove') parent.splice(i, 1);
          else parent[i] = structuredClone(op.value);
        }
      } else if (parent !== null && typeof parent === 'object') {
        const obj = parent as Record<string, Json>;
        if (op.op === 'remove') {
          if (!(last in obj)) throw new Error(`No existe "${last}"`);
          delete obj[last];
        } else if (op.op === 'replace' && !(last in obj)) throw new Error(`No existe "${last}" (usá add)`);
        else obj[last] = structuredClone(op.value);
      } else throw new Error('El padre no es objeto ni lista');
    } catch (e) {
      throw new Error(`Patch #${n} (${op.op} ${op.path}): ${(e as Error).message}`);
    }
  }
  return out as T;
}

const isObj = (v: Json): v is Record<string, Json> => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasIds = (a: Json[]) => a.length > 0 && a.every((e) => isObj(e) && 'id' in e);

/** Diff mínimo legible: listas con `id` se comparan por id; el resto por índice o reemplazo. */
export function diff(a: Json, b: Json, base: (string | number)[] = []): PatchOp[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (isObj(a) && isObj(b)) {
    // claves con valor undefined cuentan como ausentes (igual que en JSON)
    const clean = (o: Record<string, Json>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
    const A = clean(a);
    const B = clean(b);
    const ops: PatchOp[] = [];
    for (const k of Object.keys(A)) {
      if (!(k in B)) ops.push({ op: 'remove', path: joinPath([...base, k]), from: A[k] });
      else ops.push(...diff(A[k], B[k], [...base, k]));
    }
    for (const k of Object.keys(B)) if (!(k in A)) ops.push({ op: 'add', path: joinPath([...base, k]), value: B[k] });
    return ops;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (hasIds(a) && (b.length === 0 || hasIds(b))) {
      const ops: PatchOp[] = [];
      const idOf = (e: Json) => String((e as { id: unknown }).id);
      const bIds = new Set(b.map(idOf));
      const aIds = new Set(a.map(idOf));
      for (const e of a) if (!bIds.has(idOf(e))) ops.push({ op: 'remove', path: joinPath([...base, idOf(e)]), from: e });
      for (const e of b) {
        if (!aIds.has(idOf(e))) ops.push({ op: 'add', path: joinPath([...base, '-']), value: e });
        else ops.push(...diff(a.find((x) => idOf(x) === idOf(e)), e, [...base, idOf(e)]));
      }
      return ops;
    }
    if (a.length === b.length && a.some((e) => isObj(e) || Array.isArray(e))) return a.flatMap((e, i) => diff(e, b[i], [...base, i]));
  }
  return [{ op: 'replace', path: joinPath(base), value: b, from: a }];
}

/** Texto corto de una op para listas y reportes. */
export function describeOp(op: PatchOp): string {
  const show = (v: unknown) => {
    const s = JSON.stringify(v);
    return s && s.length > 60 ? s.slice(0, 57) + '…' : s;
  };
  if (op.op === 'replace') return `${op.path}: ${op.from !== undefined ? show(op.from) + ' → ' : ''}${show(op.value)}`;
  if (op.op === 'add') return `${op.path} += ${show(op.value)}`;
  return `${op.path} ✕`;
}
