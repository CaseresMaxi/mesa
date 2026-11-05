import { validatePack, type GamePack, type GamePackInput, type Issue } from '@mesa/core';

/** Validación memoizada por referencia del borrador (se usa en muchos componentes). */
const cache = new WeakMap<object, { pack: GamePack | null; issues: Issue[] }>();

export function validated(input: GamePackInput | null): { pack: GamePack | null; issues: Issue[] } {
  if (!input) return { pack: null, issues: [] };
  let v = cache.get(input);
  if (!v) {
    v = validatePack(input);
    cache.set(input, v);
  }
  return v;
}

/** Tipos cómodos sobre el input crudo (los defaults pueden faltar). */
export type FactionInput = GamePackInput['factions'][number];
export type MapInput = GamePackInput['map'];
