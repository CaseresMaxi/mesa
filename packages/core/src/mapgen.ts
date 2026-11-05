import { lcg } from './rng.ts';
import type { GameMap } from './schema.ts';

export interface MapGenOptions {
  id?: string;
  name?: string;
  seed?: number;
  nodes?: number;
  /** Terrenos a repartir de forma balanceada (ids + nombre + color). */
  terrains?: GameMap['terrains'];
  /** Cantidad de esquinas de inicio (se ubican en los extremos del tablero). */
  corners?: number;
  width?: number;
  height?: number;
  /** Grado promedio objetivo (2.6–3.6 es jugable). */
  avgDegree?: number;
  maxDegree?: number;
  /** Nombres para los nodos (si faltan, "Nodo N"). */
  names?: string[];
  slots?: { corner: number; min: number; max: number };
}

const DEFAULT_TERRAINS: GameMap['terrains'] = [
  { id: 'a', name: 'Terreno A', color: '#3f8fc4' },
  { id: 'b', name: 'Terreno B', color: '#7a7f88' },
  { id: 'c', name: 'Terreno C', color: '#e0a82e' },
];

type P = { x: number; z: number };

function segmentsCross(a: P, b: P, c: P, d: P): boolean {
  const o = (p: P, q: P, r: P) => Math.sign((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** Genera un mapa plano (conexiones sin cruces), conexo, con terrenos balanceados. */
export function generateMap(opts: MapGenOptions = {}): GameMap {
  const seed = opts.seed ?? 1;
  const n = opts.nodes ?? 12;
  const W = opts.width ?? 14;
  const H = opts.height ?? 11;
  const terrains = opts.terrains ?? DEFAULT_TERRAINS;
  const nCorners = Math.min(opts.corners ?? 4, 4, n);
  const avgDeg = opts.avgDegree ?? 3.1;
  const maxDeg = opts.maxDegree ?? 5;
  const slots = opts.slots ?? { corner: 2, min: 1, max: 2 };
  const rand = lcg(seed * 7919 + 17);
  const rf = () => rand(1_000_000) / 1_000_000;

  // 1. puntos: esquinas fijas + muestreo con distancia mínima
  const pts: P[] = [];
  const cornerPos: P[] = [
    { x: -W / 2 + 1, z: -H / 2 + 1 },
    { x: W / 2 - 1, z: H / 2 - 1 },
    { x: W / 2 - 1, z: -H / 2 + 1 },
    { x: -W / 2 + 1, z: H / 2 - 1 },
  ];
  for (let i = 0; i < nCorners; i++) pts.push({ x: cornerPos[i].x + (rf() - 0.5) * 0.6, z: cornerPos[i].z + (rf() - 0.5) * 0.6 });
  let minD = Math.sqrt((W * H) / n) * 0.75;
  for (let tries = 0; pts.length < n; tries++) {
    if (tries > 4000) (minD *= 0.9), (tries = 0);
    const p = { x: (rf() - 0.5) * (W - 1.4), z: (rf() - 0.5) * (H - 1.4) };
    if (pts.every((q) => Math.hypot(p.x - q.x, p.z - q.z) >= minD)) pts.push(p);
  }

  // 2. conexiones: MST (Kruskal) sin cruces + aristas cortas hasta el grado objetivo
  const cand: [number, number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) cand.push([i, j, Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z)]);
  cand.sort((a, b) => a[2] - b[2]);
  const parent = pts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const edges: [number, number][] = [];
  const deg = Array(n).fill(0);
  const crosses = (a: number, b: number) => edges.some(([c, d]) => c !== a && c !== b && d !== a && d !== b && segmentsCross(pts[a], pts[b], pts[c], pts[d]));
  const add = (a: number, b: number) => {
    edges.push([a, b]);
    deg[a]++;
    deg[b]++;
  };
  for (const [a, b] of cand) {
    if (find(a) !== find(b) && !crosses(a, b)) {
      parent[find(a)] = find(b);
      add(a, b);
    }
  }
  const target = Math.round((avgDeg * n) / 2);
  for (const [a, b, d] of cand) {
    if (edges.length >= target) break;
    if (edges.some(([c, e]) => (c === a && e === b) || (c === b && e === a))) continue;
    if (deg[a] >= maxDeg || deg[b] >= maxDeg || d > minD * 2.3 || crosses(a, b)) continue;
    add(a, b);
  }

  // 3. terrenos: cuotas balanceadas, evitando vecinos iguales (greedy por grado)
  const adj: number[][] = pts.map(() => []);
  for (const [a, b] of edges) adj[a].push(b), adj[b].push(a);
  const quota = new Map(terrains.map((t, i) => [t.id, Math.floor(n / terrains.length) + (i < n % terrains.length ? 1 : 0)]));
  const terrainOf: (string | null)[] = Array(n).fill(null);
  const order = [...pts.keys()].sort((a, b) => deg[b] - deg[a] || a - b);
  for (const i of order) {
    const options = terrains
      .map((t) => t.id)
      .filter((t) => quota.get(t)! > 0)
      .map((t) => ({ t, clash: adj[i].filter((j) => terrainOf[j] === t).length, left: quota.get(t)! }))
      .sort((a, b) => a.clash - b.clash || b.left - a.left || rand(3) - 1);
    const t = options[0]?.t ?? terrains[0].id;
    terrainOf[i] = t;
    quota.set(t, quota.get(t)! - 1);
  }

  const names = opts.names ?? [];
  const round = (x: number) => Math.round(x * 10) / 10;
  const nodes = pts.map((p, i) => ({
    id: i,
    name: names[i] ?? `Nodo ${i + 1}`,
    terrain: terrainOf[i]!,
    slots: i < nCorners ? slots.corner : slots.min + rand(slots.max - slots.min + 1),
    x: round(p.x),
    z: round(p.z),
    corner: i < nCorners,
  }));
  const center = pts.reduce((best, p, i) => (Math.hypot(p.x, p.z) < Math.hypot(pts[best].x, pts[best].z) ? i : best), nCorners < n ? nCorners : 0);
  return {
    id: opts.id ?? `mapa-${seed}`,
    name: opts.name ?? `Mapa generado ${seed}`,
    terrains,
    nodes,
    edges: edges.map(([a, b]) => (a < b ? [a, b] : [b, a]) as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    startCorners: [...Array(nCorners).keys()],
    center,
  };
}

export interface MapAnalysis {
  nodes: number;
  edges: number;
  avgDegree: number;
  minDegree: number;
  maxDegree: number;
  diameter: number;
  connected: boolean;
  /** Nodos cuya eliminación desconecta el mapa (cuellos de botella). */
  chokepoints: number[];
  /** Distancias entre esquinas de inicio (todas contra todas). */
  cornerDistances: number[];
  /** Por asiento: nodos a distancia ≤1 / ≤2 de su esquina (territorio inicial). */
  cornerReach: { corner: number; r1: number; r2: number }[];
  terrainCounts: Record<string, number>;
  slotsByTerrain: Record<string, number>;
  /** Conexiones entre nodos del mismo terreno. */
  sameTerrainEdges: number;
  crossings: number;
}

export function analyzeMap(map: GameMap): MapAnalysis {
  const n = map.nodes.length;
  const adj: number[][] = map.nodes.map(() => []);
  for (const [a, b] of map.edges) if (a < n && b < n) adj[a].push(b), adj[b].push(a);
  const bfs = (src: number, skip = -1) => {
    const d = Array(n).fill(Infinity);
    d[src] = 0;
    const q = [src];
    while (q.length) {
      const u = q.shift()!;
      for (const v of adj[u]) if (v !== skip && d[v] === Infinity) (d[v] = d[u] + 1), q.push(v);
    }
    return d;
  };
  const dist = map.nodes.map((_, i) => bfs(i));
  const finite = dist.flat().filter((x) => x !== Infinity);
  const connected = dist[0].every((x) => x !== Infinity);
  const chokepoints: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = i === 0 ? 1 : 0;
    const d = bfs(start, i);
    if (d.some((x, j) => j !== i && x === Infinity)) chokepoints.push(i);
  }
  const corners = map.startCorners;
  const cornerDistances: number[] = [];
  for (let i = 0; i < corners.length; i++) for (let j = i + 1; j < corners.length; j++) cornerDistances.push(dist[corners[i]]?.[corners[j]] ?? Infinity);
  const terrainCounts: Record<string, number> = {};
  const slotsByTerrain: Record<string, number> = {};
  for (const nd of map.nodes) {
    terrainCounts[nd.terrain] = (terrainCounts[nd.terrain] ?? 0) + 1;
    slotsByTerrain[nd.terrain] = (slotsByTerrain[nd.terrain] ?? 0) + nd.slots;
  }
  let crossings = 0;
  const P = (i: number) => map.nodes[i];
  for (let i = 0; i < map.edges.length; i++)
    for (let j = i + 1; j < map.edges.length; j++) {
      const [a, b] = map.edges[i];
      const [c, d] = map.edges[j];
      if (new Set([a, b, c, d]).size === 4 && segmentsCross(P(a), P(b), P(c), P(d))) crossings++;
    }
  const degs = adj.map((a) => a.length);
  return {
    nodes: n,
    edges: map.edges.length,
    avgDegree: Math.round((degs.reduce((a, b) => a + b, 0) / n) * 100) / 100,
    minDegree: Math.min(...degs),
    maxDegree: Math.max(...degs),
    diameter: Math.max(...finite),
    connected,
    chokepoints,
    cornerDistances,
    cornerReach: corners.map((c) => ({ corner: c, r1: dist[c].filter((x) => x <= 1).length, r2: dist[c].filter((x) => x <= 2).length })),
    terrainCounts,
    slotsByTerrain,
    sameTerrainEdges: map.edges.filter(([a, b]) => map.nodes[a]?.terrain === map.nodes[b]?.terrain).length,
    crossings,
  };
}
