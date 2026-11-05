import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createEngine, parsePack, playGame } from '../src/index.ts';
import { loadPackInput } from '../src/node.ts';

/**
 * Paridad con el motor original de root-3d: las mismas 300 partidas de bots (misma semilla,
 * mismas facciones y asientos) tienen que terminar exactamente igual (ganador, turno, PV, RNG y tablero).
 * El golden se generó corriendo el motor hardcodeado de root-3d (commit e41aaaa).
 */
const golden = JSON.parse(readFileSync(new URL('./fixtures/root3d-golden.json', import.meta.url), 'utf8')) as {
  seed: number; winner: string | null; turn: number; moves: number; rng: number; vp: Record<string, number>; logLen: number; board: string;
}[];
const hash = (s: string) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; } return x.toString(16); };

describe('paridad carrera-neural ↔ root-3d', () => {
  const engine = createEngine(parsePack(loadPackInput('carrera-neural')));
  const all = ['google', 'meta', 'anthropic', 'openai', 'deepseek', 'redditor'];
  const combos: number[][] = [];
  for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) combos.push([a, b]);
  it('300 partidas idénticas', () => {
    for (const g of golden) {
      const out = combos[g.seed % 15];
      const four = all.filter((_, i) => !out.includes(i));
      const rot = [...four.slice(g.seed % 4), ...four.slice(0, g.seed % 4)];
      const s = playGame(engine, rot, g.seed);
      const got = { seed: g.seed, winner: s.winner, turn: s.turn, moves: s.moveCount, rng: s.rng, vp: Object.fromEntries(s.order.map((f) => [f, s.factions[f].vp])), logLen: s.log.at(-1)?.seq, board: hash(JSON.stringify(s.nodes)) };
      expect(got).toEqual(g);
    }
  }, 120000);
});
