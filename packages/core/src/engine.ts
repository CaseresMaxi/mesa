import { rngOf } from './rng.ts';
import type { Cond, Effect, Expr, Faction, GamePack, Requirement, ScoreRule } from './schema.ts';
import type { Card, FactionId, FactionState, GameConfig, GameState, GameView, Move, MoveResult, NodeState, Piece } from './state.ts';

/**
 * Motor genérico de control de área, parametrizado por un GamePack.
 * Arquetipos: `standard` (guerreros + edificios/fichas) y `nomad` (un peón con inventario).
 * Las habilidades de facción se declaran con el DSL de `schema.ts` (Cond / Expr / Effect).
 */
export type Engine = ReturnType<typeof createEngine>;

interface Ctx {
  s: GameState;
  f: FactionId;
  node: number;
  vars?: Record<string, number>;
}

export function createEngine(pack: GamePack) {
  const { rules, map, cards } = pack;
  const FACTIONS: Record<string, Faction> = Object.fromEntries(pack.factions.map((f) => [f.id, f]));
  const NODES = map.nodes;
  const ADJ: number[][] = NODES.map(() => []);
  for (const [a, b] of map.edges) {
    ADJ[a].push(b);
    ADJ[b].push(a);
  }
  const SUIT = Object.fromEntries(cards.suits.map((s) => [s.id, s]));
  const T = rules.terms;

  // ───────────────────────── textos ─────────────────────────

  function fmt(tpl: string, vars: Record<string, unknown> = {}): string {
    return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  }
  function text(key: string, def: string, vars: Record<string, unknown> = {}): string {
    return fmt(rules.texts[key] ?? def, vars);
  }
  const nodeName = (id: number) => NODES[id].name;

  // ───────────────────────── mapa ─────────────────────────

  const neighbors = (n: number) => ADJ[n];
  const isAdjacent = (a: number, b: number) => ADJ[a].includes(b);
  function distance(a: number, b: number): number {
    if (a === b) return 0;
    const seen = new Set([a]);
    let frontier = [a];
    let d = 0;
    while (frontier.length) {
      d++;
      const next: number[] = [];
      for (const g of frontier)
        for (const n of ADJ[g]) {
          if (n === b) return d;
          if (!seen.has(n)) {
            seen.add(n);
            next.push(n);
          }
        }
      frontier = next;
    }
    return Infinity;
  }
  const validNode = (n: number) => Number.isInteger(n) && n >= 0 && n < NODES.length;

  // ───────────────────────── consultas ─────────────────────────

  const currentFaction = (s: GameState) => s.order[s.current];
  const warriorsAt = (g: NodeState, f: FactionId) => g.warriors[f] ?? 0;
  const isNomad = (f: FactionId) => FACTIONS[f].archetype === 'nomad';

  function presence(g: NodeState, f: FactionId): number {
    if (isNomad(f)) return 0;
    return warriorsAt(g, f) + g.buildings.filter((b) => b.faction === f).length;
  }

  /** Facción que gobierna el nodo (máxima presencia estricta) o null. */
  function ruler(s: GameState, node: number): FactionId | null {
    const g = s.nodes[node];
    let best: FactionId | null = null;
    let bestN = 0;
    let tie = false;
    for (const f of s.order) {
      const n = presence(g, f);
      if (n > bestN) {
        best = f;
        bestN = n;
        tie = false;
      } else if (n === bestN && n > 0) tie = true;
    }
    return tie ? null : best;
  }

  const suitMatches = (suit: string, node: number) => !!SUIT[suit]?.wild || suit === NODES[node].terrain;
  const cardPays = (f: FactionId, suit: string, node: number) => FACTIONS[f].anyCard || suitMatches(suit, node);

  function hasAnyPieces(g: NodeState, f: FactionId): boolean {
    return warriorsAt(g, f) > 0 || g.buildings.some((b) => b.faction === f) || g.tokens.some((t) => t.faction === f);
  }
  const findCard = (fs: FactionState, id: number) => fs.hand.find((c) => c.id === id);

  // ───────────────────────── DSL ─────────────────────────

  function owners(s: GameState, f: FactionId, of: string): FactionId[] {
    if (of === 'self') return [f];
    if (of === 'any') return s.order;
    return s.order.filter((o) => o !== f && (of === 'rival' || !isNomad(o)));
  }

  function countPieces(g: NodeState, who: FactionId[], sel: string): number {
    let n = 0;
    for (const o of who) {
      if (sel === 'warrior' || sel === 'any') n += warriorsAt(g, o);
      if (sel === 'building' || sel === 'any') n += g.buildings.filter((b) => b.faction === o).length;
      if (sel === 'token' || sel === 'any') n += g.tokens.filter((t) => t.faction === o).length;
    }
    return n;
  }

  function cond(c: Cond, x: Ctx): boolean {
    const g = x.s.nodes[x.node];
    if ('ruledBy' in c) {
      const r = ruler(x.s, x.node);
      return c.ruledBy === 'self' ? r === x.f : c.ruledBy === 'rival' ? r !== null && r !== x.f : c.ruledBy === 'none' ? r === null : r !== null;
    }
    if ('has' in c) return countPieces(g, owners(x.s, x.f, c.of), c.has) >= (c.min ?? 1);
    if ('terrain' in c) return NODES[x.node].terrain === c.terrain;
    if ('supply' in c) {
      const fs = x.s.factions[x.f];
      const v = c.supply === 'warriors' ? fs.warriorsSupply : c.supply === 'buildings' ? fs.buildingsSupply : fs.tokensSupply;
      return v >= (c.min ?? 1);
    }
    if ('neighbor' in c) return neighbors(x.node).some((n) => cond(c.neighbor, { ...x, node: n }));
    if ('all' in c) return c.all.every((k) => cond(k, x));
    if ('any' in c) return c.any.some((k) => cond(k, x));
    if ('not' in c) return !cond(c.not, x);
    if ('corner' in c) return NODES[x.node].corner === c.corner;
    return false;
  }

  function expr(e: Expr, x: Ctx): number {
    if (typeof e === 'number') return e;
    if ('count' in e) return x.s.nodes.filter((g) => cond(e.where, { ...x, node: g.id })).length;
    if ('stat' in e) {
      const fs = x.s.factions[x.f];
      const def = FACTIONS[x.f];
      switch (e.stat) {
        case 'battlesWon':
          return x.s.battlesWon;
        case 'vp':
          return fs.vp;
        case 'hand':
          return fs.hand.length;
        case 'warriorsSupply':
          return fs.warriorsSupply;
        case 'buildingsSupply':
          return fs.buildingsSupply;
        case 'tokensSupply':
          return fs.tokensSupply;
        case 'buildingsPlaced':
          return (def.building?.count ?? 0) - fs.buildingsSupply;
        case 'tokensPlaced':
          return (def.token?.count ?? 0) - fs.tokensSupply;
        case 'items':
          return fs.items?.length ?? 0;
        case 'turn':
          return x.s.turn;
      }
    }
    if ('rivalsAt' in e) {
      const at = pawnNode(x.s, x.f);
      return at < 0 ? 0 : x.s.order.filter((o) => o !== x.f && hasAnyPieces(x.s.nodes[at], o)).length;
    }
    if ('ref' in e) return x.vars?.[e.ref] ?? 0;
    if ('div' in e) return Math.floor(expr(e.div[0], x) / e.div[1]);
    if ('mul' in e) return Math.floor(expr(e.mul[0], x) * e.mul[1]);
    if ('sum' in e) return e.sum.reduce((a: number, k: Expr) => a + expr(k, x), 0);
    if ('min' in e) return Math.min(...e.min.map((k) => expr(k, x)));
    if ('max' in e) return Math.max(...e.max.map((k) => expr(k, x)));
    if ('table' in e) {
      const i = Math.max(0, Math.min(expr(e.of, x), e.table.length - 1));
      return e.table[i];
    }
    return 0;
  }

  function firstFailed(reqs: Requirement[], x: Ctx): string | null {
    for (const r of reqs) if (!cond(r.cond, x)) return r.error;
    return null;
  }

  function runEffects(effects: Effect[], x: Ctx, source: string) {
    const { s, f } = x;
    const fs = s.factions[f];
    for (const e of effects) {
      switch (e.do) {
        case 'placeWarriors': {
          let added = 0;
          for (const g of s.nodes) {
            if (fs.warriorsSupply <= 0) break;
            if (cond(e.where, { ...x, node: g.id })) {
              const k = Math.min(e.amount, fs.warriorsSupply);
              g.warriors[f] = warriorsAt(g, f) + k;
              fs.warriorsSupply -= k;
              added += k;
            }
          }
          if (added && e.log) log(s, f, fmt(e.log, { n: added }));
          break;
        }
        case 'gainVp': {
          const n = expr(e.amount, x);
          gainVp(s, f, n, fmt(e.why, { vp: n, node: x.node >= 0 ? nodeName(x.node) : '' }), source);
          break;
        }
        case 'drawCards':
          for (let i = 0; i < e.amount; i++) drawCard(s, f);
          if (e.log) log(s, f, fmt(e.log, { n: e.amount }));
          break;
        case 'refreshItems': {
          const n = refreshItems(fs, e.amount, f);
          if (n && e.log) log(s, f, fmt(e.log, { n }));
          break;
        }
        case 'convertWarrior': {
          const g = s.nodes[x.node];
          const victim = acquireTarget(s, x.node, f);
          if (!victim || fs.warriorsSupply <= 0) break;
          g.warriors[victim] = warriorsAt(g, victim) - 1;
          if (g.warriors[victim] === 0) delete g.warriors[victim];
          s.factions[victim].warriorsSupply++;
          g.warriors[f] = warriorsAt(g, f) + 1;
          fs.warriorsSupply--;
          if (e.log) log(s, f, fmt(e.log, { victim: FACTIONS[victim].short, node: nodeName(x.node) }));
          break;
        }
        case 'log':
          log(s, f, fmt(e.text, { node: x.node >= 0 ? nodeName(x.node) : '' }));
          break;
      }
    }
  }

  // ───────────────────────── nómade ─────────────────────────

  function pawnNode(s: GameState, f: FactionId): number {
    return s.nodes.findIndex((g) => warriorsAt(g, f) > 0);
  }
  const freshCount = (fs: FactionState, kind: string) => (fs.items ?? []).filter((i) => i.kind === kind && !i.exhausted).length;
  function exhaust(fs: FactionState, kind: string) {
    fs.items!.find((i) => i.kind === kind && !i.exhausted)!.exhausted = true;
  }
  function burnAny(fs: FactionState, f: FactionId): string | null {
    for (const k of FACTIONS[f].nomad!.burnOrder) if (freshCount(fs, k) > 0) return exhaust(fs, k), k;
    return null;
  }
  function refreshItems(fs: FactionState, n: number, f: FactionId): number {
    if (!fs.items) return 0;
    const order = FACTIONS[f].nomad?.refreshOrder ?? [];
    let done = 0;
    for (let round = 0; round < n; round++) {
      const it = order.map((k) => fs.items!.find((i) => i.kind === k && i.exhausted)).find(Boolean);
      if (!it) break;
      it.exhausted = false;
      done++;
    }
    return done;
  }
  const itemName = (f: FactionId, kind: string) => FACTIONS[f].nomad?.items.find((i) => i.id === kind)?.name ?? kind;

  function aidTarget(s: GameState, node: number, f: FactionId): FactionId | null {
    const g = s.nodes[node];
    const count = (o: FactionId) => countPieces(g, [o], 'any');
    let best: FactionId | null = null;
    for (const o of s.order) if (o !== f && count(o) > 0 && (!best || count(o) > count(best))) best = o;
    return best;
  }

  /** Rival (no nómade) con más guerreros en el nodo; empate: orden de turno. */
  function acquireTarget(s: GameState, node: number, f: FactionId): FactionId | null {
    const g = s.nodes[node];
    let best: FactionId | null = null;
    for (const o of s.order) if (o !== f && !isNomad(o) && warriorsAt(g, o) > 0 && (!best || warriorsAt(g, o) > warriorsAt(g, best))) best = o;
    return best;
  }

  // ───────────────────────── setup ─────────────────────────

  function buildDeck(): Card[] {
    const deck: Card[] = [];
    let id = 1;
    for (const grp of cards.deck) for (let i = 0; i < grp.count; i++) deck.push({ id: id++, suit: grp.suit, name: grp.names[i % grp.names.length] });
    return deck;
  }

  function createGame(config: GameConfig): GameState {
    const { players } = config;
    const { min, max } = pack.pack.players;
    if (players.length < min || players.length > Math.min(max, map.startCorners.length))
      throw new Error(`Se necesitan de ${min} a ${Math.min(max, map.startCorners.length)} jugadores`);
    if (new Set(players.map((p) => p.faction)).size !== players.length) throw new Error('Facciones repetidas');
    for (const p of players) if (!FACTIONS[p.faction]) throw new Error(`Facción desconocida: ${p.faction}`);

    const s: GameState = {
      version: 1,
      pack: pack.pack.id,
      seed: config.seed >>> 0,
      rng: config.seed >>> 0,
      turn: 1,
      current: 0,
      phase: 'dia',
      actionsLeft: 0,
      freeBattle: false,
      effortUsed: false,
      specialUsed: false,
      battlesWon: 0,
      order: players.map((p) => p.faction),
      factions: {},
      nodes: NODES.map((g) => ({ id: g.id, warriors: {}, buildings: [], tokens: [] })),
      deck: [],
      discard: [],
      log: [],
      lastBattle: null,
      winner: null,
      moveCount: 0,
      stats: {},
    };
    s.deck = rngOf(s).shuffle(buildDeck());

    players.forEach((p, seat) => {
      const def = FACTIONS[p.faction];
      s.factions[p.faction] = {
        id: p.faction,
        seat,
        playerName: p.name,
        vp: 0,
        hand: [],
        warriorsSupply: def.warriors.count,
        buildingsSupply: def.building?.count ?? 0,
        tokensSupply: def.token?.count ?? 0,
        ...(def.nomad ? { items: def.nomad.startItems.map((kind) => ({ kind, exhausted: false })) } : {}),
      };
      s.stats[p.faction] = {};
    });

    players.forEach((p, seat) => {
      const corner = map.startCorners[seat];
      const fs = s.factions[p.faction];
      const def = FACTIONS[p.faction];
      const place = (node: number, n: number) => {
        const k = Math.min(n, fs.warriorsSupply);
        if (k <= 0) return;
        s.nodes[node].warriors[p.faction] = warriorsAt(s.nodes[node], p.faction) + k;
        fs.warriorsSupply -= k;
      };
      for (const step of def.setup) {
        const targets =
          step.at === 'corner' ? [corner] : step.at === 'cornerNeighbors' ? neighbors(corner) : step.at === 'center' ? [map.center ?? 0] : [step.at.node];
        for (const t of targets) {
          if (step.warriors) place(t, step.warriors);
          if (step.building && def.building && fs.buildingsSupply > 0) {
            s.nodes[t].buildings.push({ faction: p.faction, kind: def.building.kind });
            fs.buildingsSupply--;
          }
          if (step.token && def.token && fs.tokensSupply > 0) {
            s.nodes[t].tokens.push({ faction: p.faction, kind: def.token.kind });
            fs.tokensSupply--;
          }
        }
      }
    });

    for (const f of s.order) for (let i = 0; i < rules.startingHand; i++) drawCard(s, f);
    log(s, null, text('start', 'Comienza la partida (semilla {seed}).', { seed: s.seed }));
    startTurn(s);
    return s;
  }

  // ───────────────────────── mutadores ─────────────────────────

  function log(s: GameState, faction: FactionId | null, t: string) {
    s.log.push({ seq: s.log.length, turn: s.turn, faction, text: t });
    if (s.log.length > rules.logLimit) s.log.splice(0, s.log.length - rules.logLimit);
  }

  function drawCard(s: GameState, f: FactionId) {
    if (s.deck.length === 0) {
      if (s.discard.length === 0) return;
      s.deck = rngOf(s).shuffle(s.discard);
      s.discard = [];
      log(s, null, text('reshuffle', 'El mazo se rebaraja con el descarte.'));
    }
    s.factions[f].hand.push(s.deck.pop()!);
  }

  function spendCard(s: GameState, f: FactionId, cardId: number): Card {
    const fs = s.factions[f];
    const [c] = fs.hand.splice(
      fs.hand.findIndex((k) => k.id === cardId),
      1,
    );
    s.discard.push(c);
    return c;
  }

  function gainVp(s: GameState, f: FactionId, n: number, why: string, source: string) {
    if (n <= 0 || s.winner) return;
    const fs = s.factions[f];
    fs.vp += n;
    const st = (s.stats[f] ??= {});
    st[source] = (st[source] ?? 0) + n;
    log(s, f, text('vp', '+{n} {vpName} ({why}). Total {total}.', { n, why, total: fs.vp, vpName: T.vp }));
    if (fs.vp >= rules.victoryVp) {
      s.winner = f;
      s.phase = 'fin';
      log(s, f, text('win', '¡{name} gana la partida con {vp} {vpName}!', { name: FACTIONS[f].name, vp: fs.vp, vpName: T.vp }));
    }
  }

  function startTurn(s: GameState) {
    const f = currentFaction(s);
    const def = FACTIONS[f];
    const fs = s.factions[f];
    s.phase = 'dia';
    s.actionsLeft = def.actions;
    s.freeBattle = def.battle.free;
    s.effortUsed = false;
    s.specialUsed = false;
    s.battlesWon = 0;
    log(s, f, text('turn', 'Turno {turn}: {player} ({short}).', { turn: s.turn, player: fs.playerName, short: def.short }));
    runEffects(def.onTurnStart, { s, f, node: -1 }, 'turnStart');
    if (def.nomad && def.nomad.refreshPerTurn > 0) {
      const n = refreshItems(fs, def.nomad.refreshPerTurn, f);
      if (n) log(s, f, text('nomadRefresh', '{start} — recupera {n} componente(s).', { n, start: T.turnStart }));
    }
  }

  function scoreRule(s: GameState, f: FactionId, r: ScoreRule): { vp: number; why: string } {
    const x: Ctx = { s, f, node: -1, vars: {} };
    for (const [k, e] of Object.entries(r.vars ?? {})) x.vars![k] = expr(e, x);
    const vp = expr(r.vp, x);
    return { vp, why: fmt(r.why, { ...x.vars, vp }) };
  }

  /** PV que sumaría la facción en el cierre si cerrara ahora. */
  function closingScore(s: GameState, f: FactionId): { vp: number; why: string; id?: string }[] {
    return FACTIONS[f].onClose.map((r) => ({ ...scoreRule(s, f, r), id: r.id }));
  }

  function endDay(s: GameState) {
    const f = currentFaction(s);
    FACTIONS[f].onClose.forEach((r, i) => {
      const { vp, why } = scoreRule(s, f, r);
      gainVp(s, f, vp, why, `close:${r.id ?? i}`);
    });
    if (s.winner) return;
    for (let i = 0; i < rules.drawPerTurn; i++) drawCard(s, f);
    if (s.factions[f].hand.length > rules.handLimit) {
      s.phase = 'descarte';
      log(s, f, text('mustDiscard', 'Cierre: debe descartar hasta {n} cartas.', { n: rules.handLimit }));
      return;
    }
    nextTurn(s);
  }

  function nextTurn(s: GameState) {
    s.current = (s.current + 1) % s.order.length;
    s.turn++;
    startTurn(s);
  }

  function removePieces(s: GameState, g: NodeState, victim: FactionId, hits: number, by: FactionId) {
    const vs = s.factions[victim];
    let warriors = 0;
    let structures = 0;
    if (isNomad(victim)) {
      let burned = 0;
      let lost = 0;
      for (; hits > 0; hits--) {
        if (burnAny(vs, victim)) burned++;
        else if (vs.items!.length) vs.items!.pop(), lost++;
      }
      if (burned + lost)
        log(s, victim, text('nomadHit', 'Recibe golpes: {burned} componente(s) quemado(s){lost}.', { burned, lost: lost ? `, ${lost} perdido(s)` : '' }));
      return { warriors: 0, structures: 0 };
    }
    while (hits > 0 && warriorsAt(g, victim) > 0) {
      g.warriors[victim] = warriorsAt(g, victim) - 1;
      vs.warriorsSupply++;
      warriors++;
      hits--;
    }
    const take = (list: Piece[], back: () => void) => {
      while (hits > 0) {
        const i = list.findIndex((p) => p.faction === victim);
        if (i < 0) break;
        list.splice(i, 1);
        back();
        structures++;
        hits--;
      }
    };
    take(g.buildings, () => vs.buildingsSupply++);
    take(g.tokens, () => vs.tokensSupply++);
    if (warriorsAt(g, victim) === 0) delete g.warriors[victim];
    const killVp = warriors * FACTIONS[by].battle.vpPerWarriorKill;
    if (structures) gainVp(s, by, structures * rules.battle.vpPerStructure, text('whyStructures', 'estructuras rivales caídas'), 'structures');
    if (killVp) gainVp(s, by, killVp, text('whyKills', 'guerreros rivales eliminados'), 'kills');
    return { warriors, structures };
  }

  function resolveBattle(s: GameState, node: number, att: FactionId, def: FactionId) {
    const g = s.nodes[node];
    const rng = rngOf(s);
    const attW = warriorsAt(g, att);
    const defW = warriorsAt(g, def);
    const dice = (f: FactionId, w: number) => {
      const d = FACTIONS[f];
      if (d.nomad) return Math.min(3, (s.factions[f].items ?? []).filter((i) => i.kind === d.nomad!.battleDiceItem).length);
      return Math.min(w, d.battle.maxDice);
    };
    const attackerRolls = Array.from({ length: dice(att, attW) }, () => rng.int(1, 6));
    const defenderRolls = Array.from({ length: dice(def, defW) }, () => rng.int(1, 6));
    let attackerHits = attackerRolls.filter((r) => r >= rules.battle.hitOn).length;
    let defenderHits = defenderRolls.filter((r) => r >= rules.battle.hitOn).length;
    if (defW === 0) attackerHits += rules.battle.undefendedBonus;
    if (defW > 0) defenderHits += FACTIONS[def].battle.defenseBonus;
    s.lastBattle = { seq: s.moveCount, node, attacker: att, defender: def, attackerRolls, defenderRolls, attackerHits, defenderHits };
    log(
      s,
      att,
      text('battle', '{battle} en {node} contra {def}: [{a}] vs [{d}] → {ah} a {dh}.', {
        battle: cap(T.battle),
        node: nodeName(node),
        def: FACTIONS[def].short,
        a: attackerRolls.join(', '),
        d: defenderRolls.join(', ') || '—',
        ah: attackerHits,
        dh: defenderHits,
      }),
    );
    const dealt = removePieces(s, g, def, attackerHits, att);
    const taken = removePieces(s, g, att, defenderHits, def);
    if (dealt.warriors + dealt.structures > taken.warriors + taken.structures) s.battlesWon++;
  }

  // ───────────────────────── validación ─────────────────────────

  function checkEffort(s: GameState, fs: FactionState, cardId: number): string | null {
    if (!rules.effort) return 'Esta acción no existe en este juego';
    if (s.effortUsed) return `Ya hiciste ${T.effort} este turno`;
    const c = findCard(fs, cardId);
    if (!c) return 'Carta inexistente';
    if (c.suit !== rules.effort.suit) return `${cap(T.effort)} requiere una carta de ${SUIT[rules.effort.suit]?.name ?? rules.effort.suit}`;
    return null;
  }

  /** null si el move es legal para ese asiento, o un mensaje de error. */
  function validateMove(s: GameState, seat: number, m: Move): string | null {
    if (s.phase === 'fin') return 'La partida terminó';
    const f = currentFaction(s);
    const fs = s.factions[f];
    if (fs.seat !== seat) return 'No es tu turno';
    const def = FACTIONS[f];

    if (s.phase === 'descarte') {
      if (m.type !== 'descartar') return 'Tenés que descartar';
      const need = fs.hand.length - rules.handLimit;
      if (!Array.isArray(m.cards) || new Set(m.cards).size !== m.cards.length) return 'Selección inválida';
      if (m.cards.length !== need) return `Descartá exactamente ${need}`;
      if (!m.cards.every((id) => findCard(fs, id))) return 'Carta inexistente';
      return null;
    }
    if (def.archetype === 'nomad') return validateNomad(s, f, fs, m);

    switch (m.type) {
      case 'descartar':
        return 'No hay que descartar ahora';
      case 'terminarDia':
        return null;
      case 'esfuerzo':
        return checkEffort(s, fs, m.card);
    }
    if (m.type === 'scrapear' || m.type === 'finetune') return 'Acción exclusiva de facciones nómades';
    if (m.type !== 'mover' && !validNode(m.node)) return `${cap(T.node)} inválido`;
    const card = (id: number, node: number) => {
      const c = findCard(fs, id);
      if (!c) return 'Carta inexistente';
      if (!cardPays(f, c.suit, node)) return `La carta no coincide con el ${T.node}`;
      return null;
    };
    const x = (node: number): Ctx => ({ s, f, node });

    switch (m.type) {
      case 'mover': {
        if (s.actionsLeft <= 0) return 'Sin acciones';
        if (!validNode(m.from) || !validNode(m.to)) return `${cap(T.node)} inválido`;
        if (m.from === m.to) return 'Origen y destino iguales';
        const have = warriorsAt(s.nodes[m.from], f);
        if (!Number.isInteger(m.count) || m.count < 1 || m.count > have) return 'Cantidad inválida';
        const d = def.move.range === 1 ? (isAdjacent(m.from, m.to) ? 1 : Infinity) : distance(m.from, m.to);
        if (d > def.move.range) return 'Destino fuera de alcance';
        if (def.move.needsRule && ruler(s, m.from) !== f && ruler(s, m.to) !== f) return 'Tenés que gobernar el origen o el destino';
        return null;
      }
      case 'reclutar': {
        if (s.actionsLeft <= 0) return 'Sin acciones';
        if (!def.recruit) return `${def.short} no recluta`;
        if (fs.warriorsSupply <= 0) return `No quedan ${def.warriors.name} en la reserva`;
        return card(m.card, m.node) ?? firstFailed(def.recruit.requires, x(m.node));
      }
      case 'construir': {
        if (s.actionsLeft <= 0) return 'Sin acciones';
        if (!def.building) return `${def.short} no construye`;
        if (fs.buildingsSupply <= 0) return `No quedan ${def.building.name.toLowerCase()}s`;
        const e = card(m.card, m.node);
        if (e) return e;
        if (ruler(s, m.node) !== f) return `Tenés que gobernar el ${T.node}`;
        if (s.nodes[m.node].buildings.length >= NODES[m.node].slots) return 'No hay espacio libre';
        return null;
      }
      case 'encender': {
        if (s.actionsLeft <= 0) return 'Sin acciones';
        if (!def.token) return `${def.short} no coloca fichas`;
        if (fs.tokensSupply <= 0) return `No quedan ${def.token.name.toLowerCase()}s`;
        const e = card(m.card, m.node);
        if (e) return e;
        if (s.nodes[m.node].tokens.some((t) => t.faction === f)) return `Ya hay un ${def.token.name.toLowerCase()} ahí`;
        return firstFailed(def.token.requires, x(m.node));
      }
      case 'especial': {
        if (s.actionsLeft <= 0) return 'Sin acciones';
        if (!def.special) return `${def.short} no tiene habilidad especial`;
        if (s.specialUsed) return `Ya usaste ${def.special.name} este turno`;
        const e = card(m.card, m.node);
        if (e) return e;
        if (warriorsAt(s.nodes[m.node], f) <= 0) return `Necesitás ${def.warriors.name} en el ${T.node}`;
        return firstFailed(def.special.requires, x(m.node));
      }
      case 'batalla': {
        if (s.actionsLeft <= 0 && !s.freeBattle) return 'Sin acciones';
        if (m.target === f) return 'No podés atacarte';
        if (!s.factions[m.target]) return 'Facción inexistente';
        const g = s.nodes[m.node];
        if (warriorsAt(g, f) <= 0) return `Necesitás ${def.warriors.name} en el ${T.node}`;
        if (!hasAnyPieces(g, m.target)) return 'El objetivo no tiene piezas ahí';
        return null;
      }
    }
    return 'Move desconocido';
  }

  function validateNomad(s: GameState, f: FactionId, fs: FactionState, m: Move): string | null {
    const nd = FACTIONS[f].nomad!;
    const at = pawnNode(s, f);
    const need = (k: string) => (freshCount(fs, k) > 0 ? null : `Necesitás un ${itemName(f, k)} sin quemar`);
    switch (m.type) {
      case 'descartar':
        return 'No hay que descartar ahora';
      case 'terminarDia':
        return null;
      case 'esfuerzo': {
        const e = checkEffort(s, fs, m.card);
        if (e) return e;
        if (!fs.items!.some((i) => i.exhausted)) return 'No tenés componentes quemados';
        return null;
      }
      case 'mover': {
        if (!validNode(m.from) || !validNode(m.to)) return `${cap(T.node)} inválido`;
        if (m.from !== at) return 'Tu peón no está ahí';
        if (m.count !== 1) return 'Cantidad inválida';
        if (!isAdjacent(m.from, m.to)) return 'Destino fuera de alcance';
        return need(nd.actionItems.move);
      }
      case 'batalla': {
        if (!validNode(m.node) || m.node !== at) return `Tenés que estar en ese ${T.node}`;
        if (m.target === f) return 'No podés atacarte';
        if (!s.factions[m.target]) return 'Facción inexistente';
        if (!hasAnyPieces(s.nodes[m.node], m.target)) return 'El objetivo no tiene piezas ahí';
        return need(nd.actionItems.battle);
      }
      case 'scrapear':
        return need(nd.actionItems.draw);
      case 'finetune': {
        if (!validNode(m.node) || m.node !== at) return `Tenés que estar en ese ${T.node}`;
        if (fs.items!.length >= nd.maxItems) return `Ya tenés ${nd.maxItems} componentes`;
        const c = findCard(fs, m.card);
        if (!c) return 'Carta inexistente';
        if (!suitMatches(c.suit, m.node)) return `La carta no coincide con el ${T.node}`;
        return need(nd.actionItems.finetune);
      }
      case 'especial': {
        if (!FACTIONS[f].special) return 'Sin habilidad especial';
        if (!validNode(m.node) || m.node !== at) return `Tenés que estar en ese ${T.node}`;
        if (s.specialUsed) return `Ya usaste ${FACTIONS[f].special!.name} este turno`;
        if (!findCard(fs, m.card)) return 'Carta inexistente';
        if (!fs.items!.some((i) => !i.exhausted)) return 'No te quedan componentes sin quemar';
        const t = m.target ?? aidTarget(s, m.node, f);
        if (!t || t === f || !s.factions[t]) return `No hay rivales en tu ${T.node}`;
        if (!hasAnyPieces(s.nodes[m.node], t)) return `Ese rival no está en tu ${T.node}`;
        return null;
      }
    }
    return 'Acción no disponible para esta facción';
  }

  function applyNomad(s: GameState, f: FactionId, fs: FactionState, m: Move) {
    const nd = FACTIONS[f].nomad!;
    switch (m.type) {
      case 'mover':
        exhaust(fs, nd.actionItems.move);
        delete s.nodes[m.from].warriors[f];
        s.nodes[m.to].warriors[f] = 1;
        log(s, f, text('nomadMove', 'Se mueve a {node}.', { node: nodeName(m.to) }));
        return;
      case 'batalla':
        exhaust(fs, nd.actionItems.battle);
        resolveBattle(s, m.node, f, m.target);
        return;
      case 'scrapear':
        exhaust(fs, nd.actionItems.draw);
        drawCard(s, f);
        log(s, f, text('nomadDraw', '{verb}: roba 1 carta.', { verb: nd.items.find((i) => i.id === nd.actionItems.draw)?.verb ?? 'Robar' }));
        return;
      case 'finetune': {
        exhaust(fs, nd.actionItems.finetune);
        const c = spendCard(s, f, m.card);
        const kind = nd.suitItem[c.suit] ?? nd.items[0].id;
        fs.items!.push({ kind, exhausted: false });
        log(s, f, text('nomadFinetune', 'Mejora su equipo con {card}: nuevo componente ({item}).', { card: c.name, item: itemName(f, kind) }));
        gainVp(s, f, nd.finetuneVp, text('whyFinetune', 'mejora'), 'finetune');
        return;
      }
      case 'especial': {
        const t = m.target ?? aidTarget(s, m.node, f)!;
        const burned = burnAny(fs, f)!;
        const [c] = fs.hand.splice(
          fs.hand.findIndex((k) => k.id === m.card),
          1,
        );
        s.factions[t].hand.push(c);
        s.specialUsed = true;
        log(s, f, text('nomadAid', '{special}: le regala una carta a {target} (quema {item}).', { special: FACTIONS[f].special!.name, target: FACTIONS[t].short, item: itemName(f, burned) }));
        gainVp(s, f, nd.aidVp, text('whyAid', 'karma'), 'special');
        return;
      }
      case 'esfuerzo':
        spendCard(s, f, m.card);
        refreshItems(fs, 1, f);
        s.effortUsed = true;
        log(s, f, text('nomadEffort', '{effort}: quema una carta y recupera 1 componente.', { effort: cap(T.effort) }));
        return;
    }
  }

  // ───────────────────────── aplicación ─────────────────────────

  function applyMove(state: GameState, seat: number, m: Move): MoveResult {
    const err = validateMove(state, seat, m);
    if (err) return { ok: false, error: err };
    const s: GameState = structuredClone(state);
    const f = currentFaction(s);
    const fs = s.factions[f];
    const def = FACTIONS[f];
    s.moveCount++;

    if (def.archetype === 'nomad' && m.type !== 'terminarDia' && m.type !== 'descartar') {
      applyNomad(s, f, fs, m);
      return { ok: true, state: s };
    }

    switch (m.type) {
      case 'mover': {
        const from = s.nodes[m.from];
        const to = s.nodes[m.to];
        from.warriors[f] = warriorsAt(from, f) - m.count;
        if (from.warriors[f] === 0) delete from.warriors[f];
        to.warriors[f] = warriorsAt(to, f) + m.count;
        s.actionsLeft--;
        log(s, f, text('move', 'Mueve {n} {unit} de {from} a {to}.', { n: m.count, unit: m.count === 1 ? def.warriors.singular : def.warriors.name, from: nodeName(m.from), to: nodeName(m.to) }));
        break;
      }
      case 'reclutar': {
        spendCard(s, f, m.card);
        const n = Math.min(def.recruit!.amount, fs.warriorsSupply);
        const g = s.nodes[m.node];
        g.warriors[f] = warriorsAt(g, f) + n;
        fs.warriorsSupply -= n;
        s.actionsLeft--;
        log(s, f, text('recruit', 'Recluta {n} {unit} en {node}.', { n, unit: n === 1 ? def.warriors.singular : def.warriors.name, node: nodeName(m.node) }));
        break;
      }
      case 'construir': {
        spendCard(s, f, m.card);
        const b = def.building!;
        const idx = b.count - fs.buildingsSupply;
        s.nodes[m.node].buildings.push({ faction: f, kind: b.kind });
        fs.buildingsSupply--;
        s.actionsLeft--;
        log(s, f, text('build', 'Construye {what} en {node}.', { what: b.name.toLowerCase(), node: nodeName(m.node) }));
        gainVp(s, f, b.vp[Math.min(idx, b.vp.length - 1)], b.name.toLowerCase(), 'build');
        break;
      }
      case 'encender': {
        spendCard(s, f, m.card);
        s.nodes[m.node].tokens.push({ faction: f, kind: def.token!.kind });
        fs.tokensSupply--;
        s.actionsLeft--;
        log(s, f, text('token', 'Coloca {what} en {node}.', { what: def.token!.name.toLowerCase(), node: nodeName(m.node) }));
        break;
      }
      case 'especial': {
        spendCard(s, f, m.card);
        s.actionsLeft--;
        s.specialUsed = true;
        runEffects(def.special!.effects, { s, f, node: m.node }, 'special');
        break;
      }
      case 'batalla': {
        if (s.freeBattle) s.freeBattle = false;
        else s.actionsLeft--;
        resolveBattle(s, m.node, f, m.target);
        break;
      }
      case 'esfuerzo': {
        spendCard(s, f, m.card);
        s.actionsLeft++;
        s.effortUsed = true;
        log(s, f, text('effort', '{effort}: quema una carta y gana 1 acción.', { effort: cap(T.effort) }));
        break;
      }
      case 'terminarDia':
        log(s, f, text('endTurn', 'Cierra el turno.'));
        endDay(s);
        break;
      case 'descartar':
        for (const id of m.cards) spendCard(s, f, id);
        log(s, f, text('discard', 'Descarta {n} carta(s).', { n: m.cards.length }));
        nextTurn(s);
        break;
    }
    return { ok: true, state: s };
  }

  /** Moves sin azar ni información nueva: se pueden deshacer dentro del turno. */
  function isUndoable(m: Move): boolean {
    return ['mover', 'reclutar', 'construir', 'encender', 'especial', 'esfuerzo', 'finetune'].includes(m.type);
  }

  /** Filtra la info oculta. `seat = null` → espectador. */
  function playerView(s: GameState, seat: number | null): GameView {
    const v = structuredClone(s) as GameView;
    v.deckCount = s.deck.length;
    v.deck = [];
    v.rng = 0;
    v.seed = 0;
    v.viewer = seat;
    v.handCounts = {};
    for (const f of s.order) {
      const fs = v.factions[f];
      v.handCounts[f] = fs.hand.length;
      if (fs.seat !== seat) fs.hand = [];
    }
    return v;
  }

  /** Todos los moves legales del jugador actual (para bots, IA y la UI). */
  function legalMoves(s: GameState): Move[] {
    if (s.phase === 'fin') return [];
    const f = currentFaction(s);
    const fs = s.factions[f];
    const seat = fs.seat;
    const out: Move[] = [];
    const push = (m: Move) => {
      if (validateMove(s, seat, m) === null) out.push(m);
    };
    if (s.phase === 'descarte') {
      push({ type: 'descartar', cards: fs.hand.slice(rules.handLimit).map((c) => c.id) });
      return out;
    }
    for (const g of s.nodes) {
      for (const c of fs.hand)
        for (const type of ['reclutar', 'construir', 'encender', 'especial', 'finetune'] as const) push({ type, node: g.id, card: c.id });
      for (const o of s.order) if (o !== f) push({ type: 'batalla', node: g.id, target: o });
      const w = warriorsAt(g, f);
      for (const t of s.nodes) for (let k = 1; k <= w; k++) push({ type: 'mover', from: g.id, to: t.id, count: k });
    }
    for (const c of fs.hand) push({ type: 'esfuerzo', card: c.id });
    push({ type: 'scrapear' });
    push({ type: 'terminarDia' });
    return out;
  }

  return {
    pack,
    factions: FACTIONS,
    nodes: NODES,
    createGame,
    validateMove,
    applyMove,
    playerView,
    legalMoves,
    isUndoable,
    closingScore,
    currentFaction,
    ruler,
    presence,
    warriorsAt,
    neighbors,
    isAdjacent,
    distance,
    cardPays,
    suitMatches,
    pawnNode,
    aidTarget,
    acquireTarget,
    freshCount,
    buildDeck,
    evalCond: (c: Cond, s: GameState, f: FactionId, node: number) => cond(c, { s, f, node }),
    evalExpr: (e: Expr, s: GameState, f: FactionId, node = -1) => expr(e, { s, f, node }),
  };
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
