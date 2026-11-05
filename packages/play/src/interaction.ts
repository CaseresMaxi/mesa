import type { Engine, GameState, Move } from '@mesa/core';

/**
 * La UI de acciones es genérica: parte de `engine.legalMoves(state)` y va pidiendo, campo por campo,
 * lo que falta para dejar un único move. Así cualquier pack se juega sin escribir UI específica.
 */
export type MoveType = Move['type'];
export type Field = 'from' | 'to' | 'count' | 'node' | 'card' | 'target';

export const FIELDS: Record<MoveType, Field[]> = {
  mover: ['from', 'to', 'count'],
  reclutar: ['node', 'card'],
  construir: ['node', 'card'],
  encender: ['node', 'card'],
  especial: ['node', 'card'],
  finetune: ['node', 'card'],
  batalla: ['node', 'target'],
  esfuerzo: ['card'],
  scrapear: [],
  terminarDia: [],
  descartar: [],
};

export type Selection = { type: MoveType } & Partial<Record<Field, number | string>>;

const get = (m: Move, f: Field): number | string | undefined => (m as unknown as Record<string, number | string | undefined>)[f];

export function candidates(legal: Move[], sel: Selection): Move[] {
  return legal.filter((m) => m.type === sel.type && FIELDS[sel.type].every((f) => sel[f] === undefined || get(m, f) === sel[f]));
}

export function nextField(sel: Selection): Field | null {
  return FIELDS[sel.type].find((f) => sel[f] === undefined) ?? null;
}

export function options(legal: Move[], sel: Selection, field: Field): (number | string)[] {
  const vals = new Set<number | string>();
  for (const m of candidates(legal, sel)) {
    const v = get(m, field);
    if (v !== undefined) vals.add(v);
  }
  return [...vals].sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))));
}

/** Completa automáticamente los campos con una sola opción. Devuelve el move si quedó determinado. */
export function settle(legal: Move[], sel: Selection): { sel: Selection; move: Move | null } {
  let s = { ...sel };
  for (;;) {
    const f = nextField(s);
    if (!f) {
      const c = candidates(legal, s);
      return { sel: s, move: c[0] ?? null };
    }
    const opts = options(legal, s, f);
    if (opts.length !== 1) return { sel: s, move: null };
    s = { ...s, [f]: opts[0] };
  }
}

/** Nombre de cada tipo de acción en el vocabulario del pack. */
export function moveLabel(engine: Engine, s: GameState, type: MoveType): string {
  const f = engine.factions[engine.currentFaction(s)];
  const t = engine.pack.rules.terms;
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  const nomadVerb = (k: 'move' | 'battle' | 'draw' | 'finetune') => {
    const id = f.nomad?.actionItems[k];
    return f.nomad?.items.find((i) => i.id === id)?.verb;
  };
  switch (type) {
    case 'mover':
      return (f.nomad && nomadVerb('move')) || cap(t.move);
    case 'reclutar':
      return cap(t.recruit);
    case 'construir':
      return `${cap(t.build)} ${f.building?.name.toLowerCase() ?? ''}`.trim();
    case 'encender':
      return `Colocar ${f.token?.name.toLowerCase() ?? t.token}`;
    case 'especial':
      return f.special?.name ?? 'Especial';
    case 'batalla':
      return (f.nomad && nomadVerb('battle')) || cap(t.battle);
    case 'esfuerzo':
      return cap(t.effort);
    case 'scrapear':
      return nomadVerb('draw') ?? 'Robar';
    case 'finetune':
      return nomadVerb('finetune') ?? 'Mejorar';
    case 'terminarDia':
      return 'Terminar turno';
    case 'descartar':
      return 'Descartar';
  }
}

export const FIELD_PROMPT: Record<Field, string> = {
  from: 'Elegí el origen en el tablero',
  to: 'Elegí el destino',
  count: '¿Cuántos?',
  node: 'Elegí dónde en el tablero',
  card: 'Elegí la carta para pagar',
  target: '¿Contra quién?',
};
