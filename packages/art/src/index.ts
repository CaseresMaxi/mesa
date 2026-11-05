import type { AssetEntry, Faction, GamePack } from '@mesa/core';
import { INK, PAPER, PARCHMENT, Pen, rng, setRoughness, shade, svgDoc } from './ink.ts';
import { VIGNETTES } from './library/cards.ts';
import { CHARACTER_DRAWERS } from './library/characters.ts';
import { drawCluster, drawDatacenter, drawDemoToken, drawItem, drawLab, drawRepo, drawSuitIcon } from './library/world.ts';

export { Pen, setFontCss, setRoughness, shade, svgDoc, INK, PAPER, PARCHMENT } from './ink.ts';

/**
 * Generador de assets "dibujados a mano" (rough.js + acuarela) a partir del pack.
 * Cada asset es una receta + params. `collectAssets` arma la lista automática (cartas, fichas,
 * edificios, guerreros, tablero, dados, íconos) y le superpone las entradas del manifest
 * (misma id = override de params / archivo propio).
 */

export interface ResolvedAsset extends AssetEntry {
  name: string;
  w: number;
  h: number;
  /** true si viene (o la modifica) el manifest. */
  manual: boolean;
}

type Draw = (p: Pen, pack: GamePack, params: Record<string, unknown>) => void;

interface Recipe {
  w: number;
  h: number;
  description: string;
  params: string;
  draw: Draw;
  grain?: boolean;
}

// ───────────────────────── librería (dibujos con nombre) ─────────────────────────

/** Dibujos reutilizables por nombre (`library` recipe o params.drawer). Vienen del arte de root-3d. */
export const LIBRARY: Record<string, { w: number; h: number; draw: (p: Pen, color: string) => void }> = {
  datacenter: { w: 256, h: 256, draw: drawDatacenter },
  repo: { w: 256, h: 256, draw: drawRepo },
  laboratorio: { w: 256, h: 256, draw: drawLab },
  cluster: { w: 256, h: 256, draw: drawCluster },
  demo: { w: 256, h: 256, draw: drawDemoToken },
  ...Object.fromEntries(Object.entries(CHARACTER_DRAWERS).map(([k, d]) => [`character:${k}`, { w: 240, h: 300, draw: (p: Pen, c: string) => d(p, c) }])),
  ...Object.fromEntries(['cafe', 'gpu', 'dataset', 'teclado'].map((k) => [`item:${k}`, { w: 128, h: 128, draw: (p: Pen) => drawItem(p, k) }])),
  ...Object.fromEntries(Object.entries(VIGNETTES).map(([k, d]) => [`vignette:${k}`, { w: 200, h: 200, draw: (p: Pen) => d(p) }])),
};

const KNOWN_ICONS = new Set(['datos', 'computo', 'talento', 'hype']);

// ───────────────────────── helpers ─────────────────────────

export function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    if (line && (line + ' ' + w).length > max) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : d);
const faction = (pack: GamePack, id: unknown): Faction | undefined => pack.factions.find((f) => f.id === id);
const suitOf = (pack: GamePack, id: unknown) => pack.cards.suits.find((s) => s.id === id);

/** Ícono de palo: los conocidos usan el dibujo de la librería; el resto, círculo con inicial. */
function suitIcon(p: Pen, pack: GamePack, suitId: string, cx = 64, cy = 64, s = 1) {
  const suit = suitOf(pack, suitId) ?? pack.map.terrains.find((t) => t.id === suitId);
  const icon = suit && 'icon' in suit ? suit.icon : undefined;
  if (icon && KNOWN_ICONS.has(icon)) return drawSuitIcon(p, icon, cx, cy, s);
  const color = suit?.color ?? '#888888';
  p.g(`translate(${cx - 64 * s} ${cy - 64 * s}) scale(${s})`, () => {
    p.circle(64, 64, 112, { fill: '#fbf3dc', sw: 3 });
    p.circle(64, 64, 76, { fill: color, hachure: shade(color, 0.6), gap: 6 });
    p.text(64, 80, (suit?.name ?? suitId).charAt(0).toUpperCase(), { size: 48, color: '#fffaf0' });
  });
}

/** Ficha cuadrada con marco de color de facción. */
function tile(p: Pen, color: string, round = false) {
  if (round) {
    p.circle(128, 128, 232, { fill: color, sw: 3.5 });
    p.circle(128, 128, 196, { fill: PARCHMENT, sw: 2 });
  } else {
    p.rect(12, 12, 232, 232, { fill: color, sw: 3.5 });
    p.rect(30, 30, 196, 196, { fill: PARCHMENT, sw: 2 });
  }
}

/** Meeple genérico en color de facción. */
function meeple(p: Pen, color: string, label: string) {
  p.washEllipse(120, 288, 70, 10, '#000000', 0.18);
  p.path(
    'M120 40 Q152 40 152 76 Q152 100 134 110 L196 136 Q214 146 204 166 Q196 178 176 172 L156 166 L170 280 L132 280 L120 220 L108 280 L70 280 L84 166 L64 172 Q44 178 36 166 Q26 146 44 136 L106 110 Q88 100 88 76 Q88 40 120 40 Z',
    { fill: color, hachure: shade(color, 0.6), gap: 9, sw: 3 },
  );
  p.circle(108, 72, 10, { fill: '#fffaf0', stroke: 'none', flat: true }).circle(132, 72, 10, { fill: '#fffaf0', stroke: 'none', flat: true });
  p.circle(110, 74, 4, { fill: INK, stroke: 'none', flat: true }).circle(134, 74, 4, { fill: INK, stroke: 'none', flat: true });
  p.text(120, 210, label, { size: 44, color: '#fffaf0' });
}

// ───────────────────────── recetas ─────────────────────────

export const RECIPES: Record<string, Recipe> = {
  'suit-icon': {
    w: 128,
    h: 128,
    params: '{ suit }',
    description: 'Ícono del palo/terreno (los conocidos usan dibujo propio, el resto inicial sobre color).',
    grain: false,
    draw: (p, pack, o) => suitIcon(p, pack, str(o.suit)),
  },
  card: {
    w: 200,
    h: 280,
    params: '{ name, suit, vignette? }',
    description: 'Carta de mazo: marco del color del palo, viñeta (librería vignette:<nombre>) o ícono grande, título.',
    draw: (p, pack, o) => {
      const suit = suitOf(pack, o.suit);
      const c = suit?.color ?? '#888888';
      const name = str(o.name, 'Carta');
      p.rect(6, 6, 188, 268, { fill: PAPER, sw: 3 });
      p.rect(16, 16, 168, 168, { fill: shade(c, 1.55), sw: 1.8 });
      p.washEllipse(100, 110, 70, 50, shade(c, 1.2), 0.45);
      const vig = LIBRARY[`vignette:${str(o.vignette, name)}`];
      if (vig) vig.draw(p, c);
      else suitIcon(p, pack, str(o.suit), 100, 104, 0.95);
      suitIcon(p, pack, str(o.suit), 30, 30, 0.34);
      p.path('M14 196 L186 196 L180 222 L186 248 L14 248 L20 222 Z', { fill: c, sw: 2 });
      p.text(100, 232, name, { size: name.length > 14 ? 20 : name.length > 11 ? 23 : 28, color: '#fffaf0' });
      p.text(100, 268, `${suit?.name ?? str(o.suit)}${suit?.wild ? ' · comodín' : ''}`, { size: 16, font: 'hand', color: shade(c, 0.55) });
    },
  },
  'card-back': {
    w: 200,
    h: 280,
    params: '{ title?, color? }',
    description: 'Dorso del mazo con el nombre del juego.',
    draw: (p, pack, o) => {
      const c = str(o.color, '#2e3a56');
      p.rect(6, 6, 188, 268, { fill: c, hachure: shade(c, 0.7), gap: 10, sw: 3 });
      p.rect(18, 18, 164, 244, { stroke: '#e9d9a8', sw: 2 });
      const layers = [[70, 110, 150], [90, 130], [70, 110, 150]];
      for (let i = 0; i < layers.length - 1; i++)
        for (const y1 of layers[i]) for (const y2 of layers[i + 1]) p.line(56 + i * 44, y1, 100 + i * 44, y2, { stroke: '#e9d9a8', sw: 1.2, single: true, opacity: 0.6 });
      for (const [i, ys] of layers.entries()) for (const y of ys) p.circle(56 + i * 44, y, 18, { fill: '#e9d9a8', sw: 1.8 });
      const words = wrap(str(o.title, pack.pack.name), 10);
      words.slice(0, 2).forEach((w, i) => p.text(100, 220 + i * 30, w, { size: 30, color: i ? '#f2c14e' : '#f4ead2' }));
    },
  },
  die: {
    w: 128,
    h: 128,
    params: '{ value: 1-6, color }',
    description: 'Cara de dado d6 (los impactos según rules.battle.hitOn llevan círculo).',
    draw: (p, pack, o) => {
      const v = Math.max(1, Math.min(6, num(o.value, 1)));
      const color = str(o.color, '#c4532b');
      const PIPS: Record<number, [number, number][]> = {
        1: [[64, 64]],
        2: [[38, 38], [90, 90]],
        3: [[36, 36], [64, 64], [92, 92]],
        4: [[38, 38], [90, 38], [38, 90], [90, 90]],
        5: [[38, 38], [90, 38], [64, 64], [38, 90], [90, 90]],
        6: [[38, 34], [90, 34], [38, 64], [90, 64], [38, 94], [90, 94]],
      };
      p.rect(4, 4, 120, 120, { fill: shade(color, 1.6), hachure: shade(color, 1.1), gap: 12, sw: 3 });
      if (v >= pack.rules.battle.hitOn) p.circle(64, 64, 112, { stroke: shade(color, 0.7), sw: 2.4, rough: 1.6 });
      for (const [x, y] of PIPS[v]) p.circle(x, y, 18, { fill: INK, sw: 1.4 });
    },
  },
  warrior: {
    w: 240,
    h: 300,
    params: '{ faction, drawer? }',
    description: 'Guerrero/peón de la facción: dibujo de librería (drawer, ej. "character:google") o meeple genérico.',
    grain: false,
    draw: (p, pack, o) => {
      const f = faction(pack, o.faction);
      const color = str(o.color, f?.color ?? '#888888');
      const lib = LIBRARY[str(o.drawer)];
      if (lib) lib.draw(p, color);
      else meeple(p, color, (f?.short ?? '?').charAt(0));
    },
  },
  building: {
    w: 256,
    h: 256,
    params: '{ faction, kind?, drawer? }',
    description: 'Edificio de la facción. Si existe un dibujo de librería con el mismo kind (datacenter, repo...) lo usa.',
    grain: false,
    draw: (p, pack, o) => {
      const f = faction(pack, o.faction);
      const color = str(o.color, f?.color ?? '#888888');
      const lib = LIBRARY[str(o.drawer, str(o.kind, f?.building?.kind ?? ''))];
      if (lib) return lib.draw(p, color);
      tile(p, color);
      p.path('M60 200 L60 120 L128 66 L196 120 L196 200 Z', { fill: shade(color, 1.4), hachure: shade(color, 0.7), gap: 8, sw: 2.6 });
      p.rect(108, 146, 40, 54, { fill: shade(color, 0.6), sw: 2 });
      p.text(128, 112, (f?.building?.name ?? '?').charAt(0), { size: 40, color: INK });
    },
  },
  token: {
    w: 256,
    h: 256,
    params: '{ faction, kind?, drawer? }',
    description: 'Ficha redonda de la facción (librería por kind, ej. "demo", o genérica).',
    grain: false,
    draw: (p, pack, o) => {
      const f = faction(pack, o.faction);
      const color = str(o.color, f?.color ?? '#888888');
      const lib = LIBRARY[str(o.drawer, str(o.kind, f?.token?.kind ?? ''))];
      if (lib) return lib.draw(p, color);
      tile(p, color, true);
      p.poly([[128, 62], [146, 108], [196, 110], [156, 140], [170, 190], [128, 162], [86, 190], [100, 140], [60, 110], [110, 108]], { fill: shade(color, 1.3), sw: 2.4 });
    },
  },
  item: {
    w: 128,
    h: 128,
    params: '{ faction, item }',
    description: 'Componente de un nómade (librería item:<id> o genérico con inicial).',
    grain: false,
    draw: (p, pack, o) => {
      const lib = LIBRARY[`item:${str(o.item)}`];
      if (lib) return lib.draw(p, '#888888');
      const f = faction(pack, o.faction);
      const def = f?.nomad?.items.find((i) => i.id === o.item);
      p.rect(8, 8, 112, 112, { fill: '#fbf3dc', sw: 3 });
      p.circle(64, 58, 64, { fill: f?.color ?? '#888888', hachure: shade(f?.color ?? '#888888', 0.6), gap: 6 });
      p.text(64, 76, (def?.name ?? '?').charAt(0), { size: 44, color: '#fffaf0' });
      p.text(64, 112, def?.name ?? str(o.item), { size: 16, font: 'hand' });
    },
  },
  'faction-card': {
    w: 320,
    h: 540,
    params: '{ faction, drawer? }',
    description: 'Carta de facción: retrato, números clave y resumen de reglas (faction.summary).',
    draw: (p, pack, o) => {
      const f = faction(pack, o.faction);
      if (!f) return;
      const c = f.color;
      const W = 320;
      p.rect(6, 6, W - 12, 528, { fill: c, sw: 3.4 });
      p.rect(16, 16, W - 32, 508, { fill: PAPER, sw: 2 });
      p.path(`M10 30 L${W - 10} 30 L${W - 22} 52 L${W - 10} 74 L10 74 L22 52 Z`, { fill: c, sw: 2.4 });
      p.text(W / 2, 64, f.name, { size: f.name.length > 12 ? 32 : 38, color: '#fffaf0' });
      p.g('translate(100 84) scale(0.5)', () => {
        const lib = LIBRARY[str(o.drawer, `character:${f.id}`)];
        if (lib) lib.draw(p, c);
        else meeple(p, c, f.short.charAt(0));
      });
      const stats = [
        `${f.warriors.count} ${f.warriors.name}`,
        f.building ? `${f.building.count} ${f.building.name.toLowerCase()}s` : f.token ? `${f.token.count} ${f.token.name.toLowerCase()}s` : f.nomad ? `${f.nomad.startItems.length} componentes` : '',
        f.archetype === 'nomad' ? 'nómade' : `${f.actions} acciones`,
      ].filter(Boolean);
      p.text(W / 2, 252, stats.join(' · '), { size: stats.join(' · ').length > 34 ? 14 : 17, font: 'hand', color: shade(c, 0.55) });
      wrap(f.tagline, 34)
        .slice(0, 2)
        .forEach((l, i) => p.text(W / 2, 276 + i * 20, l, { size: 16, font: 'hand', color: '#6b5a44' }));
      let y = 330;
      for (const line of f.summary) {
        const ls = wrap(line, 38);
        if (y + ls.length * 18 > 516) break;
        p.circle(30, y - 5, 7, { fill: c, stroke: 'none', flat: true });
        ls.forEach((l, i) => p.text(40, y + i * 18, l, { size: 15, font: 'hand', anchor: 'start' }));
        y += ls.length * 18 + 8;
      }
    },
  },
  board: {
    w: 1600,
    h: 1200,
    params: '{ margin? }',
    description: 'Tablero completo pintado a partir de map.json (terrenos, conexiones, slots, esquinas, nombres).',
    draw: (p, pack, o) => drawBoard(p, pack, num(o.margin, 110)),
  },
  library: {
    w: 256,
    h: 256,
    params: '{ drawer, color? }  (drawer: ver LIBRARY)',
    description: 'Cualquier dibujo con nombre de la librería.',
    grain: false,
    draw: (p, _pack, o) => LIBRARY[str(o.drawer)]?.draw(p, str(o.color, '#888888')),
  },
};

/** Coordenadas de tablero → píxeles del SVG del tablero. */
export function boardTransform(pack: GamePack, W = 1600, H = 1200, margin = 110) {
  const xs = pack.map.nodes.map((n) => n.x);
  const zs = pack.map.nodes.map((n) => n.z);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  // arriba queda lugar para el título y abajo para las etiquetas de nombre
  const top = margin + 50;
  const bottom = margin + 40;
  const k = Math.min((W - 2 * margin) / (x1 - x0 || 1), (H - top - bottom) / (z1 - z0 || 1));
  const ox = (W - (x1 - x0) * k) / 2;
  const oz = top + (H - top - bottom - (z1 - z0) * k) / 2;
  return (x: number, z: number): [number, number] => [ox + (x - x0) * k, oz + (z - z0) * k];
}

function drawBoard(p: Pen, pack: GamePack, margin: number) {
  const W = 1600;
  const H = 1200;
  const map = pack.map;
  const at = boardTransform(pack, W, H, margin);
  const color = (t: string) => map.terrains.find((x) => x.id === t)?.color ?? '#999999';
  const rand = rng(7);
  p.rect(8, 8, W - 16, H - 16, { fill: PARCHMENT, sw: 4, rough: 1.4 });
  // manchas de fondo por terreno
  for (const n of map.nodes) {
    const [x, y] = at(n.x, n.z);
    p.washEllipse(x, y, 150, 120, shade(color(n.terrain), 1.5), 0.35);
  }
  for (let i = 0; i < 60; i++) p.washEllipse(rand() * W, rand() * H, 20 + rand() * 40, 14 + rand() * 30, '#c9b98a', 0.12);
  // conexiones
  for (const [a, b] of map.edges) {
    const [x1, y1] = at(map.nodes[a].x, map.nodes[a].z);
    const [x2, y2] = at(map.nodes[b].x, map.nodes[b].z);
    const mx = (x1 + x2) / 2 + (rand() - 0.5) * 30;
    const my = (y1 + y2) / 2 + (rand() - 0.5) * 30;
    p.curve([[x1, y1], [mx, my], [x2, y2]], { stroke: '#8a6a3e', sw: 14, single: true, rough: 0.8, opacity: 0.5 });
    p.curve([[x1, y1], [mx, my], [x2, y2]], { stroke: '#f6eccd', sw: 5, single: true, rough: 0.8 });
  }
  // nodos
  const R = 84;
  for (const n of map.nodes) {
    const [x, y] = at(n.x, n.z);
    const c = color(n.terrain);
    p.circle(x, y, R * 2, { fill: shade(c, 1.35), hachure: shade(c, 0.85), gap: 10, sw: 3.4 });
    p.circle(x, y, R * 2 - 22, { stroke: shade(c, 0.6), sw: 1.6, single: true, rough: 1.6 });
    suitIcon(p, pack, n.terrain, x, y - 26, 0.36);
    const sz = 30;
    for (let s = 0; s < n.slots; s++) {
      const sx = x - ((n.slots - 1) * (sz + 10)) / 2 + s * (sz + 10);
      p.rect(sx - sz / 2, y + 4, sz, sz, { fill: '#fffaf0', sw: 2 });
    }
    const seat = map.startCorners.indexOf(n.id);
    if (seat >= 0) {
      p.circle(x + R * 0.72, y - R * 0.72, 42, { fill: INK, sw: 1.6 });
      p.text(x + R * 0.72, y - R * 0.72 + 9, String(seat + 1), { size: 26, color: PARCHMENT });
    }
    const w = Math.max(110, n.name.length * 15 + 30);
    p.path(`M${x - w / 2} ${y + R - 8} L${x + w / 2} ${y + R - 8} L${x + w / 2 - 10} ${y + R + 14} L${x + w / 2} ${y + R + 36} L${x - w / 2} ${y + R + 36} L${x - w / 2 + 10} ${y + R + 14} Z`, {
      fill: shade(c, 0.85),
      sw: 2,
    });
    p.text(x, y + R + 24, n.name, { size: 28, color: '#fffaf0' });
  }
  p.text(W / 2, 62, `${pack.pack.name} — ${map.name}`, { size: 44 });
}

// ───────────────────────── colección ─────────────────────────

/** Todos los assets del pack: automáticos + manifest (misma id ⇒ el manifest pisa params/archivo). */
export function collectAssets(pack: GamePack): ResolvedAsset[] {
  const auto: AssetEntry[] = [];
  if (pack.assets.auto) {
    auto.push({ id: 'board', name: 'Tablero', category: 'Tablero', recipe: 'board', params: {} });
    for (const s of pack.cards.suits) auto.push({ id: `suit-${s.id}`, name: s.name, category: 'Íconos', recipe: 'suit-icon', params: { suit: s.id } });
    for (const t of pack.map.terrains)
      if (!pack.cards.suits.some((s) => s.id === t.id)) auto.push({ id: `suit-${t.id}`, name: t.name, category: 'Íconos', recipe: 'suit-icon', params: { suit: t.id } });
    const seen = new Set<string>();
    for (const g of pack.cards.deck)
      for (const name of g.names) {
        const id = `card-${slug(name)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        auto.push({ id, name, category: 'Cartas', recipe: 'card', params: { name, suit: g.suit } });
      }
    auto.push({ id: 'card-back', name: 'Dorso', category: 'Cartas', recipe: 'card-back', params: {} });
    for (const f of pack.factions) {
      auto.push({ id: `faction-card-${f.id}`, name: f.name, category: 'Facciones', recipe: 'faction-card', params: { faction: f.id } });
      auto.push({ id: `warrior-${f.id}`, name: `${f.warriors.singular} (${f.short})`, category: 'Guerreros', recipe: 'warrior', params: { faction: f.id } });
      if (f.building) auto.push({ id: `building-${f.id}`, name: f.building.name, category: 'Edificios y fichas', recipe: 'building', params: { faction: f.id } });
      if (f.token) auto.push({ id: `token-${f.id}`, name: f.token.name, category: 'Edificios y fichas', recipe: 'token', params: { faction: f.id } });
      for (const it of f.nomad?.items ?? []) auto.push({ id: `item-${f.id}-${it.id}`, name: it.name, category: 'Componentes', recipe: 'item', params: { faction: f.id, item: it.id } });
    }
    for (let v = 1; v <= 6; v++) auto.push({ id: `die-${v}`, name: `Dado ${v}`, category: 'Dados', recipe: 'die', params: { value: v, color: '#c4532b' } });
  }
  const byId = new Map<string, ResolvedAsset>();
  const resolve = (e: AssetEntry, manual: boolean): ResolvedAsset => {
    const r = RECIPES[e.recipe];
    return { ...e, name: e.name ?? e.id, w: e.w ?? r?.w ?? 256, h: e.h ?? r?.h ?? 256, manual };
  };
  for (const e of auto) byId.set(e.id, resolve(e, false));
  for (const e of pack.assets.entries) {
    const prev = byId.get(e.id);
    byId.set(e.id, resolve(prev ? { ...prev, ...e, params: { ...prev.params, ...e.params } } : e, true));
  }
  return [...byId.values()];
}

/** SVG del asset. Los que tienen `file` devuelven '' (el archivo lo sirve el editor / la CLI lo copia). */
export function renderAsset(pack: GamePack, asset: ResolvedAsset, seed = 1): string {
  if (asset.file) return '';
  const r = RECIPES[asset.recipe];
  if (!r) throw new Error(`Receta desconocida "${asset.recipe}" (asset ${asset.id})`);
  setRoughness(pack.assets.style.roughness);
  const p = new Pen(seed + hashStr(asset.id));
  const lib = asset.recipe === 'library' ? LIBRARY[str(asset.params.drawer)] : undefined;
  const w = asset.w ?? lib?.w ?? r.w;
  const h = asset.h ?? lib?.h ?? r.h;
  r.draw(p, pack, asset.params);
  // el contenido se dibuja en el tamaño nativo de la receta y se escala con viewBox
  const nw = lib?.w ?? r.w;
  const nh = lib?.h ?? r.h;
  return svgDoc(w, h, p.toString(), { viewBox: `0 0 ${nw} ${nh}`, grain: r.grain ?? true });
}

function hashStr(s: string) {
  let x = 0;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 100000;
  return x;
}
