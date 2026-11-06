import { clipDuration, lossCount, stepApplies, type BattleResult, type FxClip, type FxStep } from '@mesa/core';

/**
 * Runtime puro de animaciones: dado un clip, una pelea y un instante `t` (ms),
 * devuelve qué hay que dibujar. No toca el DOM: el componente React sólo pinta esto,
 * y los tests/el editor pueden muestrear cualquier instante (scrub) de forma determinista.
 */

export type Side = 'attacker' | 'defender';

export interface Figure {
  side: Side;
  /** Posición del pie de la figura. */
  x: number;
  y: number;
  rot: number;
  opacity: number;
  /** Tinte del destello (color y fuerza 0..1). */
  tint: { color: string; k: number } | null;
}

export type Sprite =
  | { kind: 'shape'; shape: 'orb' | 'bolt' | 'arrow' | 'star'; x: number; y: number; rot: number; size: number; color: string; opacity: number }
  | { kind: 'image'; asset: string; x: number; y: number; rot: number; size: number; opacity: number }
  | { kind: 'particle'; x: number; y: number; r: number; color: string; opacity: number }
  | { kind: 'ring'; x: number; y: number; r: number; width: number; color: string; opacity: number }
  | { kind: 'die'; side: Side; x: number; y: number; rot: number; size: number; value: number; hit: boolean; settled: boolean; opacity: number }
  | { kind: 'text'; x: number; y: number; text: string; size: number; color: string; opacity: number; scale: number };

export interface Frame {
  figures: Figure[];
  sprites: Sprite[];
  /** Opacidad general (fundido de salida). */
  opacity: number;
  done: boolean;
}

export interface FxContext {
  battle: BattleResult;
  clip: FxClip;
  /** Centro del nodo de la pelea, en coordenadas del tablero. */
  x: number;
  y: number;
  color(side: Side): string;
  hitOn: number;
  /** Nombre corto de cada facción y del nodo, para los textos. */
  names?: { attacker: string; defender: string; node: string };
  /** Máximo de figuras por bando (el resto se representa con el número). */
  maxFigures?: number;
}

/** Separación entre los dos bandos y el fundido de salida (ms). */
export const GAP = 125;
export const OUTRO = 350;

export const EASE: Record<FxStep['ease'], (p: number) => number> = {
  linear: (p) => p,
  in: (p) => p * p * p,
  out: (p) => 1 - (1 - p) ** 3,
  inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2),
  back: (p) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2,
  bounce: (p) => {
    const n = 7.5625;
    const d = 2.75;
    if (p < 1 / d) return n * p * p;
    if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
    if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
    return n * (p -= 2.625 / d) * p + 0.984375;
  },
};

/** Duración total, con fundido (ms, antes de la velocidad). */
export function totalDuration(clip: FxClip): number {
  return clipDuration(clip.steps) + OUTRO;
}

/** Pseudoaleatorio determinista en [0,1) a partir de enteros. */
function hash(...n: number[]): number {
  let h = 2166136261;
  for (const x of n) {
    h ^= x | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  return ((h >>> 0) % 100000) / 100000;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));

interface Group {
  side: Side;
  ox: number;
  oy: number;
  rot: number;
  tint: { color: string; k: number } | null;
}

export function frameAt(ctx: FxContext, t: number): Frame {
  const { battle: b, clip } = ctx;
  const end = clipDuration(clip.steps);
  const steps = clip.steps.map((s, i) => ({ s, i })).filter(({ s }) => stepApplies(s.when, b));
  const resolve = (c: string) => (c === 'attacker' || c === 'defender' ? ctx.color(c) : c);
  const maxF = ctx.maxFigures ?? 5;
  const groups: Record<Side, Group> = {
    attacker: { side: 'attacker', ox: 0, oy: 0, rot: 0, tint: null },
    defender: { side: 'defender', ox: 0, oy: 0, rot: 0, tint: null },
  };
  const home = (side: Side) => ({ x: ctx.x + (side === 'attacker' ? -GAP : GAP), y: ctx.y - 10 });
  const center = (who: string) => (who === 'node' ? { x: ctx.x, y: ctx.y - 55 } : { x: home(who as Side).x + groups[who as Side].ox, y: home(who as Side).y - 55 + groups[who as Side].oy });
  const sprites: Sprite[] = [];
  const sidesOf = (who: string): Side[] => (who === 'node' ? ['attacker', 'defender'] : [who as Side]);
  let deathP: number | null = null; // progreso de las bajas (null = todavía no empezó)

  // primero los movimientos (afectan dónde están los bandos), después lo que se dibuja encima
  const order = (s: FxStep) => (s.fx === 'lunge' || s.fx === 'shake' ? 0 : 1);
  for (const { s, i } of [...steps].sort((a, z) => order(a.s) - order(z.s))) {
    const local = (t - s.at) / s.dur;
    const raw = clamp(local);
    const p = EASE[s.ease](raw);
    const active = local >= 0 && local <= 1;
    switch (s.fx) {
      case 'lunge': {
        if (!active) break;
        const dir = s.who === 'attacker' ? 1 : -1;
        groups[s.who].ox += dir * s.dist * Math.sin(Math.PI * clamp(p));
        groups[s.who].oy -= 14 * Math.sin(Math.PI * raw);
        break;
      }
      case 'shake': {
        if (!active) break;
        const k = s.amp * (1 - raw);
        for (const side of sidesOf(s.who)) {
          groups[side].ox += k * Math.sin(raw * 55 + i);
          groups[side].oy += k * 0.5 * Math.cos(raw * 43 + i);
          groups[side].rot += k * 0.4 * Math.sin(raw * 37);
        }
        break;
      }
      case 'flash': {
        if (!active) break;
        for (const side of sidesOf(s.who)) groups[side].tint = { color: resolve(s.color), k: Math.sin(Math.PI * raw) };
        break;
      }
      case 'projectile': {
        const to: Side = s.from === 'attacker' ? 'defender' : 'attacker';
        const a = center(s.from);
        const z = center(to);
        const fly = s.dur * 0.6;
        const stagger = s.count > 1 ? (s.dur - fly) / (s.count - 1) : 0;
        for (let k = 0; k < s.count; k++) {
          const q = (t - s.at - k * stagger) / fly;
          if (q < 0 || q > 1) continue;
          const e = EASE[s.ease](q);
          const jitter = (hash(b.seq, i, k) - 0.5) * 40;
          const mx = (a.x + z.x) / 2;
          const my = Math.min(a.y, z.y) - s.arc + jitter;
          const x = (1 - e) ** 2 * a.x + 2 * (1 - e) * e * mx + e * e * z.x;
          const y = (1 - e) ** 2 * a.y + 2 * (1 - e) * e * my + e * e * z.y + jitter * 0.3;
          const dx = 2 * (1 - e) * (mx - a.x) + 2 * e * (z.x - mx);
          const dy = 2 * (1 - e) * (my - a.y) + 2 * e * (z.y - my);
          const rot = (Math.atan2(dy, dx) * 180) / Math.PI;
          const opacity = q > 0.92 ? (1 - q) / 0.08 : 1;
          if (s.asset) sprites.push({ kind: 'image', asset: s.asset, x, y, rot: s.shape === 'star' ? q * 720 : rot, size: s.size * 2, opacity });
          else sprites.push({ kind: 'shape', shape: s.shape, x, y, rot: s.shape === 'star' ? q * 720 : rot, size: s.size, color: resolve(s.color), opacity });
        }
        break;
      }
      case 'burst': {
        if (!active) break;
        const c = center(s.who);
        for (let k = 0; k < s.count; k++) {
          const ang = hash(b.seq, i, k, 1) * Math.PI * 2;
          const dist = s.radius * (0.4 + 0.6 * hash(b.seq, i, k, 2));
          sprites.push({
            kind: 'particle',
            x: c.x + Math.cos(ang) * dist * p,
            y: c.y + Math.sin(ang) * dist * p + 30 * raw * raw,
            r: (4 + 8 * hash(b.seq, i, k, 3)) * (1 - raw * 0.7),
            color: resolve(s.color),
            opacity: 1 - raw,
          });
        }
        break;
      }
      case 'ring': {
        if (!active) break;
        const c = center(s.who);
        sprites.push({ kind: 'ring', x: c.x, y: c.y, r: s.radius * p, width: 14 * (1 - raw) + 1, color: resolve(s.color), opacity: 1 - raw });
        break;
      }
      case 'dice': {
        if (t < s.at) break;
        const fade = t > end ? clamp(1 - (t - end) / OUTRO) : 1;
        const settled = raw >= 0.65;
        for (const side of ['attacker', 'defender'] as Side[]) {
          const rolls = side === 'attacker' ? b.attackerRolls : b.defenderRolls;
          const h = home(side);
          rolls.forEach((v, k) => {
            const tumble = clamp(raw / 0.65);
            const face = settled ? v : 1 + Math.floor(hash(b.seq, i, k, side === 'attacker' ? 7 : 9, Math.floor((t - s.at) / 70)) * 6);
            const x0 = h.x + (k - (rolls.length - 1) / 2) * (s.size + 8);
            const y0 = h.y - 190;
            sprites.push({
              kind: 'die',
              side,
              x: x0 + (settled ? 0 : (1 - tumble) * (side === 'attacker' ? -60 : 60)),
              y: y0 - (settled ? 0 : Math.abs(Math.sin(tumble * Math.PI * 2.5)) * 50 * (1 - tumble)),
              rot: settled ? 0 : (1 - tumble) * 540 * (side === 'attacker' ? 1 : -1),
              size: s.size,
              value: face,
              hit: settled && v >= ctx.hitOn,
              settled,
              opacity: fade,
            });
          });
        }
        break;
      }
      case 'casualties': {
        if (t >= s.at) deathP = raw;
        if (!active) break;
        for (const side of ['attacker', 'defender'] as Side[]) {
          const n = lossCount(side === 'attacker' ? b.attackerLosses : b.defenderLosses);
          if (!n) continue;
          const h = home(side);
          sprites.push({ kind: 'text', x: h.x, y: h.y - 125 - 50 * p, text: `-${n}`, size: 50, color: '#c0392b', opacity: raw < 0.8 ? 1 : (1 - raw) / 0.2, scale: 0.6 + 0.4 * EASE.back(clamp(raw * 3)) });
        }
        break;
      }
      case 'text': {
        if (!active) break;
        const c = center(s.who);
        const txt = s.text.replace(/\{(\w+)\}/g, (_, k: string) => {
          const v: Record<string, string | number> = {
            attacker: ctx.names?.attacker ?? b.attacker,
            defender: ctx.names?.defender ?? b.defender,
            node: ctx.names?.node ?? String(b.node),
            ah: b.attackerHits,
            dh: b.defenderHits,
            aLoss: lossCount(b.attackerLosses),
            dLoss: lossCount(b.defenderLosses),
          };
          return String(v[k] ?? `{${k}}`);
        });
        sprites.push({
          kind: 'text',
          x: c.x,
          y: s.who === 'node' ? ctx.y + 105 : c.y - 160,
          text: txt,
          size: s.size,
          color: resolve(s.color),
          opacity: raw < 0.15 ? raw / 0.15 : raw > 0.8 ? (1 - raw) / 0.2 : 1,
          scale: EASE.back(clamp(raw / 0.3)),
        });
        break;
      }
    }
  }

  // figuras de cada bando (con los que van a morir al final de la fila)
  const figures: Figure[] = [];
  for (const side of ['attacker', 'defender'] as Side[]) {
    const n = Math.min(maxF, side === 'attacker' ? b.attackerWarriors : b.defenderWarriors);
    const lost = Math.min(n, (side === 'attacker' ? b.attackerLosses : b.defenderLosses).warriors);
    const g = groups[side];
    const h = home(side);
    for (let k = 0; k < n; k++) {
      // fila en diagonal: el primero adelante, mirando al rival
      const fx = h.x + (side === 'attacker' ? -1 : 1) * k * 34 + g.ox;
      const fy = h.y + (k % 2 ? 20 : 0) - k * 5 + g.oy;
      const dying = k >= n - lost;
      if (dying && deathP !== null && deathP >= 1) continue;
      const dp = dying && deathP !== null ? deathP : 0;
      figures.push({
        side,
        x: fx + dp * (side === 'attacker' ? -20 : 20),
        y: fy + dp * 18,
        rot: g.rot + dp * (side === 'attacker' ? -80 : 80),
        opacity: 1 - dp,
        tint: g.tint,
      });
    }
  }
  const opacity = t <= end ? 1 : clamp(1 - (t - end) / OUTRO);
  // las figuras de adelante se dibujan último
  figures.reverse();
  return { figures, sprites, opacity, done: t >= end + OUTRO };
}
