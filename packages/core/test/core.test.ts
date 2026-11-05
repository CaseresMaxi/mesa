import { describe, expect, it } from 'vitest';
import {
  analyzeMap, applyBatch, applyPatch, createEngine, diff, generateMap, getPath, newBatch, parsePack,
  patchItemsFromDiff, simulate, validatePack, type GamePackInput,
} from '../src/index.ts';
import { loadPackInput } from '../src/node.ts';

const input = loadPackInput('carrera-neural');
const pack = parsePack(input);

describe('rutas por id y patches', () => {
  it('resuelve ids en listas', () => {
    expect(getPath(pack, '/factions/google/warriors/count')).toBe(20);
    expect(getPath(pack, '/map/nodes/4/name')).toBe('Investigación');
  });
  it('applyPatch no muta y valida rutas', () => {
    const out = applyPatch(input, [{ op: 'replace', path: '/factions/google/warriors/count', value: 16 }]);
    expect(getPath(out, '/factions/google/warriors/count')).toBe(16);
    expect(getPath(input, '/factions/google/warriors/count')).toBe(20);
    expect(() => applyPatch(input, [{ op: 'replace', path: '/factions/nadie/x', value: 1 }])).toThrow(/Patch #0/);
  });
  it('diff + applyPatch = ida y vuelta', () => {
    const draft = structuredClone(input) as GamePackInput;
    (draft.factions as any[])[0].battle.maxDice = 2;
    (draft.factions as any[]).push({ ...(draft.factions as any[])[1], id: 'meta2' });
    (draft.map as any).nodes[3].slots = 2;
    const ops = diff(input, draft);
    expect(ops.map((o) => o.path)).toContain('/factions/google/battle/maxDice');
    expect(applyPatch(input, ops)).toEqual(draft);
  });
});

describe('lotes', () => {
  it('convierte un diff en items y los aplica; las intenciones quedan pendientes', () => {
    const draft = applyPatch(input, [{ op: 'replace', path: '/rules/victoryVp', value: 25 }, { op: 'replace', path: '/factions/meta/move/range', value: 1 }]);
    const b = newBatch('carrera-neural', 'prueba');
    b.items.push(...patchItemsFromDiff(input, draft));
    b.items.push({ id: 'i1', kind: 'intent', title: 'Bajar a Google', text: 'que gane ~25%', targets: ['/factions/google'], constraints: [], verify: ['sim'], status: 'pending' });
    expect(b.items.filter((i) => i.kind === 'patch')).toHaveLength(2);
    const res = applyBatch(input, b);
    expect(res.failed).toEqual([]);
    expect(getPath(res.pack, '/rules/victoryVp')).toBe(25);
    expect(res.intents.map((i) => i.id)).toEqual(['i1']);
  });
});

describe('DSL', () => {
  const e = createEngine(pack);
  const s = e.createGame({ seed: 7, players: [{ faction: 'google', name: 'a' }, { faction: 'openai', name: 'b' }] });
  it('cond / expr', () => {
    expect(e.evalCond({ has: 'building', of: 'self' }, s, 'google', 0)).toBe(true);
    expect(e.evalExpr({ count: 'nodes', where: { has: 'token', of: 'self' } }, s, 'openai')).toBe(1);
    expect(e.evalExpr({ table: [0, 5, 9], of: 7 }, s, 'openai')).toBe(9);
    expect(e.evalExpr({ div: [{ sum: [3, 4] }, 2] }, s, 'openai')).toBe(3);
  });
  it('closingScore usa vars en el texto', () => {
    const [r] = e.closingScore(s, 'openai');
    expect(r).toMatchObject({ vp: 1, why: '1 lanzamientos con usuarios' });
  });
  it('legalMoves sólo devuelve moves válidos e incluye terminar', () => {
    const ms = e.legalMoves(s);
    expect(ms.length).toBeGreaterThan(1);
    expect(ms.every((m) => e.validateMove(s, 0, m) === null)).toBe(true);
    expect(ms).toContainEqual({ type: 'terminarDia' });
  });
});

describe('validación semántica', () => {
  it('detecta referencias rotas', () => {
    const bad = applyPatch(input, [
      { op: 'replace', path: '/map/nodes/2/terrain', value: 'lava' },
      { op: 'add', path: '/map/edges/-', value: [0, 99] },
      { op: 'replace', path: '/factions/google/onClose/0/vp', value: { ref: 'nope' } },
    ]);
    const msgs = validatePack(bad).issues.map((i) => i.message).join('\n');
    expect(msgs).toMatch(/Terreno desconocido "lava"/);
    expect(msgs).toMatch(/nodo inexistente/);
    expect(msgs).toMatch(/Variable "nope"/);
  });
  it('errores de forma con ruta', () => {
    const { pack: p, issues } = validatePack(applyPatch(input, [{ op: 'replace', path: '/rules/victoryVp', value: 'veinte' }]));
    expect(p).toBeNull();
    expect(issues[0].path).toBe('/rules/victoryVp');
  });
});

describe('generador de mapas', () => {
  it('genera mapas planos, conexos y balanceados', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const m = generateMap({ seed, nodes: 12, terrains: pack.map.terrains });
      const a = analyzeMap(m);
      expect(a.connected).toBe(true);
      expect(a.crossings).toBe(0);
      expect(Math.max(...Object.values(a.terrainCounts)) - Math.min(...Object.values(a.terrainCounts))).toBeLessThanOrEqual(1);
      const p2 = parsePack({ ...input, map: m });
      expect(simulate(p2, { games: 20 }).stalls).toBeLessThan(20);
    }
  });
});
