import { z } from 'zod';
import { GamePack, PACK_FILES, type Cond, type Effect, type Expr, type GamePackInput, type PackFileKey } from './schema.ts';

export interface Issue {
  level: 'error' | 'warning';
  path: string;
  message: string;
}

/** Contenido crudo de los archivos del pack (lo que hay en disco, ya parseado como JSON). */
export type PackFiles = Record<PackFileKey, unknown>;

/** Une los archivos en el objeto en memoria (sin validar). */
export function joinFiles(files: PackFiles): GamePackInput {
  const f = files.factions as { factions?: unknown } | undefined;
  return { ...files, factions: f?.factions ?? f } as GamePackInput;
}

/** Separa el pack en el contenido de cada archivo (para escribir a disco). */
export function splitPack(pack: GamePackInput | GamePack): PackFiles {
  return {
    pack: pack.pack,
    rules: pack.rules,
    map: pack.map,
    cards: pack.cards,
    factions: { $schema: '../../schemas/factions.schema.json', factions: pack.factions },
    assets: pack.assets,
  };
}

export { PACK_FILES };

/** Valida forma (zod) + coherencia (referencias cruzadas, grafo, balance básico). */
export function validatePack(input: unknown): { pack: GamePack | null; issues: Issue[] } {
  const parsed = GamePack.safeParse(input);
  if (!parsed.success) {
    return {
      pack: null,
      issues: parsed.error.issues.map((i) => ({ level: 'error', path: '/' + i.path.map(String).join('/'), message: i.message })),
    };
  }
  const pack = parsed.data;
  return { pack, issues: semanticIssues(pack) };
}

export function parsePack(input: unknown): GamePack {
  const { pack, issues } = validatePack(input);
  const errors = issues.filter((i) => i.level === 'error');
  if (!pack || errors.length) throw new Error('Pack inválido:\n' + errors.map((e) => `  ${e.path}: ${e.message}`).join('\n'));
  return pack;
}

export function semanticIssues(p: GamePack): Issue[] {
  const out: Issue[] = [];
  const err = (path: string, message: string) => out.push({ level: 'error', path, message });
  const warn = (path: string, message: string) => out.push({ level: 'warning', path, message });
  const { map, cards, rules } = p;
  const N = map.nodes.length;
  const terrains = new Set(map.terrains.map((t) => t.id));
  const suits = new Set(cards.suits.map((s) => s.id));

  // mapa
  map.nodes.forEach((n, i) => {
    if (n.id !== i) err(`/map/nodes/${i}/id`, `El id del nodo debe ser su índice (${i})`);
    if (!terrains.has(n.terrain)) err(`/map/nodes/${i}/terrain`, `Terreno desconocido "${n.terrain}"`);
    if (!suits.has(n.terrain)) warn(`/map/nodes/${i}/terrain`, `Ningún palo de cartas se llama "${n.terrain}": sólo los comodines pagan acá`);
  });
  const seen = new Set<string>();
  map.edges.forEach(([a, b], i) => {
    if (a >= N || b >= N) err(`/map/edges/${i}`, `Conexión a un nodo inexistente (${a}-${b})`);
    if (a === b) err(`/map/edges/${i}`, 'Conexión de un nodo consigo mismo');
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(k)) warn(`/map/edges/${i}`, `Conexión repetida ${k}`);
    seen.add(k);
  });
  const adj: number[][] = map.nodes.map(() => []);
  for (const [a, b] of map.edges) if (a < N && b < N) adj[a].push(b), adj[b].push(a);
  const reach = new Set([0]);
  const stack = [0];
  while (stack.length) for (const n of adj[stack.pop()!]) if (!reach.has(n)) reach.add(n), stack.push(n);
  if (reach.size !== N) err('/map/edges', `El mapa no es conexo: ${N - reach.size} nodo(s) aislado(s)`);
  adj.forEach((a, i) => a.length === 1 && warn(`/map/nodes/${i}`, `"${map.nodes[i].name}" tiene una sola conexión (callejón sin salida)`));
  map.startCorners.forEach((c, i) => c >= N && err(`/map/startCorners/${i}`, `Nodo inexistente ${c}`));
  if (new Set(map.startCorners).size !== map.startCorners.length) err('/map/startCorners', 'Esquinas repetidas');
  if (map.center !== undefined && map.center >= N) err('/map/center', 'Nodo inexistente');
  if (p.pack.players.max > map.startCorners.length) err('/pack/players/max', `Hay ${map.startCorners.length} esquinas de inicio para ${p.pack.players.max} jugadores`);
  if (p.pack.players.min > p.pack.players.max) err('/pack/players', 'min > max');

  // cartas
  cards.deck.forEach((g, i) => !suits.has(g.suit) && err(`/cards/deck/${i}/suit`, `Palo desconocido "${g.suit}"`));
  if (rules.effort && !suits.has(rules.effort.suit)) err('/rules/effort/suit', `Palo desconocido "${rules.effort.suit}"`);
  const deckSize = cards.deck.reduce((a, g) => a + g.count, 0);
  const handsNeeded = rules.startingHand * p.pack.players.max;
  if (deckSize < handsNeeded) err('/cards/deck', `El mazo (${deckSize}) no alcanza para repartir ${handsNeeded} cartas`);
  for (const t of terrains) {
    const n = cards.deck.filter((g) => g.suit === t).reduce((a, g) => a + g.count, 0);
    if (n === 0 && !cards.suits.some((s) => s.wild)) warn('/cards/deck', `No hay cartas de ${t}: nadie podrá pagar en esos nodos`);
  }

  // facciones
  const ids = new Set<string>();
  p.factions.forEach((f, i) => {
    const base = `/factions/${f.id}`;
    if (ids.has(f.id)) err(`/factions/${i}/id`, `Id repetido "${f.id}"`);
    ids.add(f.id);
    if (f.building && f.building.vp.length !== f.building.count)
      warn(`${base}/building/vp`, `La pista de PV tiene ${f.building.vp.length} valores para ${f.building.count} edificios (se repite el último)`);
    if (f.archetype === 'nomad' && !f.nomad) err(`${base}/nomad`, 'Un nómade necesita la sección "nomad"');
    if (f.archetype === 'standard' && f.actions === 0) warn(`${base}/actions`, 'Facción estándar sin acciones');
    if (f.setup.length === 0) warn(`${base}/setup`, 'Sin setup: arranca sin piezas en el tablero');
    f.setup.forEach((s, j) => {
      if (typeof s.at === 'object' && s.at.node >= N) err(`${base}/setup/${j}/at`, `Nodo inexistente ${s.at.node}`);
      if (s.building && !f.building) err(`${base}/setup/${j}/building`, 'La facción no tiene edificios');
      if (s.token && !f.token) err(`${base}/setup/${j}/token`, 'La facción no tiene fichas');
    });
    if (f.nomad) {
      const items = new Set(f.nomad.items.map((it) => it.id));
      const check = (path: string, k: string) => !items.has(k) && err(`${base}/nomad/${path}`, `Componente desconocido "${k}"`);
      f.nomad.startItems.forEach((k, j) => check(`startItems/${j}`, k));
      Object.entries(f.nomad.actionItems).forEach(([a, k]) => check(`actionItems/${a}`, k));
      check('battleDiceItem', f.nomad.battleDiceItem);
      Object.entries(f.nomad.suitItem).forEach(([s, k]) => {
        check(`suitItem/${s}`, k);
        if (!suits.has(s)) err(`${base}/nomad/suitItem/${s}`, `Palo desconocido "${s}"`);
      });
      if (f.nomad.startItems.length > f.nomad.maxItems) err(`${base}/nomad/startItems`, 'Empieza con más componentes que el máximo');
    }
    // DSL: terrenos y refs
    const visitCond = (c: Cond, path: string) => {
      if ('terrain' in c && !terrains.has(c.terrain)) err(path, `Terreno desconocido "${c.terrain}"`);
      if ('neighbor' in c) visitCond(c.neighbor, path);
      if ('all' in c) c.all.forEach((k) => visitCond(k, path));
      if ('any' in c) c.any.forEach((k) => visitCond(k, path));
      if ('not' in c) visitCond(c.not, path);
    };
    const visitExpr = (e: Expr, path: string, vars: Set<string>) => {
      if (typeof e === 'number') return;
      if ('count' in e) visitCond(e.where, path);
      if ('ref' in e && !vars.has(e.ref)) err(path, `Variable "${e.ref}" no definida en vars`);
      for (const k of ['div', 'mul'] as const) if (k in e) visitExpr((e as Record<string, [Expr, number]>)[k][0], path, vars);
      for (const k of ['sum', 'min', 'max'] as const) if (k in e) (e as Record<string, Expr[]>)[k].forEach((x) => visitExpr(x, path, vars));
      if ('table' in e) visitExpr(e.of, path, vars);
    };
    const visitEffects = (es: Effect[], path: string) =>
      es.forEach((e, j) => {
        if (e.do === 'placeWarriors') visitCond(e.where, `${path}/${j}`);
        if (e.do === 'gainVp') visitExpr(e.amount, `${path}/${j}`, new Set());
        if (e.do === 'refreshItems' && !f.nomad) warn(`${path}/${j}`, 'refreshItems sólo tiene efecto en nómades');
      });
    visitEffects(f.onTurnStart, `${base}/onTurnStart`);
    if (f.special) {
      visitEffects(f.special.effects, `${base}/special/effects`);
      f.special.requires.forEach((r, j) => visitCond(r.cond, `${base}/special/requires/${j}`));
      if (f.archetype === 'standard' && f.special.effects.length === 0) warn(`${base}/special`, 'Especial sin efectos');
    }
    f.onClose.forEach((r, j) => {
      const vars = new Set(Object.keys(r.vars ?? {}));
      Object.values(r.vars ?? {}).forEach((e) => visitExpr(e, `${base}/onClose/${j}/vars`, new Set()));
      visitExpr(r.vp, `${base}/onClose/${j}/vp`, vars);
    });
  });
  if (p.factions.length < p.pack.players.min) err('/factions', 'Menos facciones que jugadores mínimos');
  return out;
}

/** Formatea issues de zod u otros para la terminal. */
export function formatIssues(issues: Issue[]): string {
  return issues.map((i) => `${i.level === 'error' ? '✗' : '⚠'} ${i.path}  ${i.message}`).join('\n');
}

export const zodPrettify = (e: z.ZodError) => z.prettifyError(e);
