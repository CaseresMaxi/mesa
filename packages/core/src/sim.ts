import { createEngine, type Engine } from './engine.ts';
import { lcg } from './rng.ts';
import type { GamePack } from './schema.ts';
import type { GameState, Move } from './state.ts';

/**
 * Bot "codicioso" por niveles: construir/colocar/especial > batallar > reclutar > mover > terminar.
 * Con 1/3 de probabilidad saltea un nivel (ruido para explorar). Es el mismo bot que usaba
 * el test de balance de root-3d, así los números son comparables.
 */
export function greedyBot(engine: Engine, s: GameState, rand: (k: number) => number): Move {
  const f = engine.currentFaction(s);
  const fs = s.factions[f];
  const seat = fs.seat;
  const hand = fs.hand;
  if (s.phase === 'descarte') return { type: 'descartar', cards: hand.slice(engine.pack.rules.handLimit).map((c) => c.id) };
  const nomad = engine.factions[f].archetype === 'nomad';
  const tiers: Move[][] = [[], [], [], [], []];
  for (const g of engine.nodes) {
    for (const c of hand) {
      tiers[0].push({ type: 'construir', node: g.id, card: c.id }, { type: 'encender', node: g.id, card: c.id }, { type: 'especial', node: g.id, card: c.id }, { type: 'finetune', node: g.id, card: c.id });
      tiers[2].push({ type: 'reclutar', node: g.id, card: c.id });
    }
    for (const o of s.order) if ((s.nodes[g.id].warriors[f] ?? 0) >= (nomad ? 1 : 2)) tiers[1].push({ type: 'batalla', node: g.id, target: o });
    for (const t of engine.nodes) {
      const w = s.nodes[g.id].warriors[f] ?? 0;
      if (w > (nomad ? 0 : 1)) tiers[3].push({ type: 'mover', from: g.id, to: t.id, count: Math.ceil(w / 2) });
    }
  }
  tiers[2].push({ type: 'scrapear' });
  for (const t of tiers) {
    const legal = t.filter((m) => engine.validateMove(s, seat, m) === null);
    if (legal.length && rand(3) > 0) return legal[rand(legal.length)];
  }
  return { type: 'terminarDia' };
}

export interface SimOptions {
  games?: number;
  factionsPerGame?: number;
  /** Facciones a incluir (default: todas). */
  factions?: string[];
  seedStart?: number;
  maxMoves?: number;
}

export interface FactionStats {
  played: number;
  wins: number;
  winRate: number;
  avgVp: number;
  /** PV promedio por partida jugada según fuente (build, close:x, special, structures, kills...). */
  vpSources: Record<string, number>;
  /** Tasa de victoria por asiento (0 = primero). */
  seatWinRate: number[];
}

export interface SimReport {
  pack: string;
  games: number;
  factionsPerGame: number;
  finished: number;
  avgTurns: number;
  /** Partidas sin ganador al llegar al límite de moves. */
  stalls: number;
  factions: Record<string, FactionStats>;
  seatWinRate: number[];
  warnings: string[];
  ms: number;
}

function combos(n: number, k: number): number[][] {
  const out: number[][] = [];
  const rec = (start: number, acc: number[]) => {
    if (acc.length === k) return void out.push(acc);
    for (let i = start; i < n; i++) rec(i + 1, [...acc, i]);
  };
  rec(0, []);
  return out;
}

/** Juega una partida completa entre bots. Devuelve el estado final. */
export function playGame(engine: Engine, factions: string[], seed: number, maxMoves = 3000): GameState {
  let s = engine.createGame({ seed, players: factions.map((f) => ({ faction: f, name: f })) });
  const rand = lcg(seed);
  for (let i = 0; i < maxMoves && s.phase !== 'fin'; i++) {
    const m = greedyBot(engine, s, rand);
    const r = engine.applyMove(s, s.factions[engine.currentFaction(s)].seat, m);
    if (!r.ok) throw new Error(`Bot generó un move ilegal (${r.error}): ${JSON.stringify(m)}`);
    s = r.state;
  }
  return s;
}

/**
 * Simulación de balance: rota combinaciones de facciones y el orden de asientos
 * (igual que el test original: semilla i → combinación i % C, rotación i % k).
 */
export function simulate(pack: GamePack, opts: SimOptions = {}): SimReport {
  const t0 = Date.now();
  const engine = createEngine(pack);
  const all = opts.factions ?? pack.factions.map((f) => f.id);
  const k = Math.min(opts.factionsPerGame ?? pack.pack.balance.factionsPerGame, all.length, pack.pack.players.max, pack.map.startCorners.length);
  const games = opts.games ?? pack.pack.balance.games;
  const seedStart = opts.seedStart ?? 1;
  // combinaciones de facciones que quedan AFUERA (así el orden coincide con el test original)
  const outs = combos(all.length, all.length - k);
  const stats: Record<string, { played: number; wins: number; vp: number; sources: Record<string, number>; seatPlayed: number[]; seatWins: number[] }> = {};
  for (const f of all) stats[f] = { played: 0, wins: 0, vp: 0, sources: {}, seatPlayed: Array(k).fill(0), seatWins: Array(k).fill(0) };
  const seatWins = Array(k).fill(0);
  let turns = 0;
  let finished = 0;
  let stalls = 0;

  for (let seed = seedStart; seed < seedStart + games; seed++) {
    const out = outs[seed % outs.length];
    const chosen = all.filter((_, i) => !out.includes(i));
    const rot = [...chosen.slice(seed % k), ...chosen.slice(0, seed % k)];
    const s = playGame(engine, rot, seed, opts.maxMoves);
    for (const f of rot) {
      const st = stats[f];
      const seat = s.factions[f].seat;
      st.played++;
      st.seatPlayed[seat]++;
      st.vp += s.factions[f].vp;
      for (const [src, n] of Object.entries(s.stats[f] ?? {})) st.sources[src] = (st.sources[src] ?? 0) + n;
    }
    if (s.winner) {
      finished++;
      turns += s.turn;
      stats[s.winner].wins++;
      const seat = s.factions[s.winner].seat;
      stats[s.winner].seatWins[seat]++;
      seatWins[seat]++;
    } else stalls++;
  }

  const factions: Record<string, FactionStats> = {};
  for (const [f, st] of Object.entries(stats)) {
    const per = (n: number) => (st.played ? n / st.played : 0);
    factions[f] = {
      played: st.played,
      wins: st.wins,
      winRate: per(st.wins),
      avgVp: round(per(st.vp)),
      vpSources: Object.fromEntries(Object.entries(st.sources).map(([k2, v]) => [k2, round(per(v))])),
      seatWinRate: st.seatPlayed.map((p, i) => (p ? round(st.seatWins[i] / p) : 0)),
    };
  }
  const report: SimReport = {
    pack: pack.pack.id,
    games,
    factionsPerGame: k,
    finished,
    avgTurns: finished ? round(turns / finished) : 0,
    stalls,
    factions,
    seatWinRate: seatWins.map((w) => round(w / games)),
    warnings: [],
    ms: Date.now() - t0,
  };
  report.warnings = checkBalance(pack, report);
  return report;
}

/** Compara el reporte con los objetivos de `pack.balance`. */
export function balanceTargets(pack: GamePack, k: number) {
  const b = pack.pack.balance;
  return { min: b.minWinRate ?? 0.4 / k, max: b.maxWinRate ?? 1.8 / k, maxAvgTurns: b.maxAvgTurns };
}

export function checkBalance(pack: GamePack, r: SimReport): string[] {
  const b = pack.pack.balance;
  const t = balanceTargets(pack, r.factionsPerGame);
  const w: string[] = [];
  for (const [f, st] of Object.entries(r.factions)) {
    if (st.winRate < t.min) w.push(`${f} gana ${pct(st.winRate)} (< ${pct(t.min)})`);
    if (st.winRate > t.max) w.push(`${f} gana ${pct(st.winRate)} (> ${pct(t.max)})`);
  }
  if (r.avgTurns > b.maxAvgTurns) w.push(`Partidas largas: ${r.avgTurns} turnos promedio (> ${b.maxAvgTurns})`);
  if (r.stalls > r.games * 0.02) w.push(`${r.stalls} partidas sin ganador (bloqueos)`);
  const fair = 1 / r.factionsPerGame;
  r.seatWinRate.forEach((x, i) => Math.abs(x - fair) > 0.1 && w.push(`Asiento ${i + 1} gana ${pct(x)} (esperado ~${pct(fair)})`));
  return w;
}

const round = (x: number) => Math.round(x * 100) / 100;
export const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

/** Tabla de texto del reporte (para CLI / skills). */
export function formatReport(r: SimReport, baseline?: SimReport): string {
  const rows = Object.entries(r.factions).sort((a, b) => b[1].winRate - a[1].winRate);
  const lines = [
    `${r.pack}: ${r.games} partidas, ${r.factionsPerGame} facciones/partida, ${r.avgTurns} turnos prom., ${r.stalls} bloqueos (${r.ms} ms)`,
    '',
    'facción        win%    Δ       PV prom.  fuentes de PV',
  ];
  for (const [f, st] of rows) {
    const base = baseline?.factions[f];
    const delta = base ? `${st.winRate >= base.winRate ? '+' : ''}${(Math.round((st.winRate - base.winRate) * 1000) / 10).toFixed(1)}` : '';
    const src = Object.entries(st.vpSources)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    lines.push(`${f.padEnd(14)} ${pct(st.winRate).padStart(6)}  ${delta.padStart(5)}   ${String(st.avgVp).padStart(6)}    ${src}`);
  }
  lines.push('', `asientos: ${r.seatWinRate.map((x, i) => `#${i + 1} ${pct(x)}`).join(' · ')}`);
  if (r.warnings.length) lines.push('', 'Avisos:', ...r.warnings.map((w) => `  ⚠ ${w}`));
  else lines.push('', '✓ Dentro de los objetivos de balance.');
  return lines.join('\n');
}
