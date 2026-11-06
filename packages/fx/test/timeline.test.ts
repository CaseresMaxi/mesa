import { BUILTIN_CLIPS, sampleBattle } from '@mesa/core';
import { describe, expect, it } from 'vitest';
import { frameAt, totalDuration, type FxContext } from '../src/timeline.ts';

const ctx = (outcome: Parameters<typeof sampleBattle>[2], clip = BUILTIN_CLIPS.clasico): FxContext => ({
  battle: sampleBattle('a', 'b', outcome),
  clip,
  x: 500,
  y: 400,
  color: (s) => (s === 'attacker' ? '#ff0000' : '#0000ff'),
  hitOn: 4,
});

describe('timeline', () => {
  it('es determinista', () => {
    const c = ctx('gana');
    expect(frameAt(c, 600)).toEqual(frameAt(c, 600));
  });
  it('arranca con todos los guerreros y termina sin las bajas', () => {
    const c = ctx('gana');
    const start = frameAt(c, 0);
    expect(start.figures.filter((f) => f.side === 'defender')).toHaveLength(2);
    const end = frameAt(c, totalDuration(c.clip) - 360);
    expect(end.figures.filter((f) => f.side === 'defender')).toHaveLength(0);
    expect(end.figures.filter((f) => f.side === 'attacker')).toHaveLength(3);
    expect(frameAt(c, totalDuration(c.clip)).done).toBe(true);
  });
  it('los dados caen en las tiradas reales', () => {
    const c = ctx('gana');
    const dice = frameAt(c, 1500).sprites.filter((s) => s.kind === 'die');
    expect(dice.map((d) => (d.kind === 'die' ? d.value : 0))).toEqual([5, 4, 2, 3, 1]);
  });
  it('respeta las condiciones "when"', () => {
    // en "gana" el atacante no pierde nada: no hay destello sobre el atacante
    const win = frameAt(ctx('gana'), 1000).figures.filter((f) => f.side === 'attacker' && f.tint);
    const lose = frameAt(ctx('pierde'), 1000).figures.filter((f) => f.side === 'attacker' && f.tint);
    expect(win).toHaveLength(0);
    expect(lose.length).toBeGreaterThan(0);
  });
  it('todos los clips incorporados corren sin romperse', () => {
    for (const clip of Object.values(BUILTIN_CLIPS))
      for (const o of ['gana', 'pierde', 'empate', 'sin-defensa'] as const)
        for (let t = 0; t <= totalDuration(clip); t += 50) expect(() => frameAt(ctx(o, clip), t)).not.toThrow();
  });
});
