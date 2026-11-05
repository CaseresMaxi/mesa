import { expect, it } from 'vitest';
import { balanceTargets, parsePack, simulate } from '../src/index.ts';
import { listPacks, loadPackInput } from '../src/node.ts';

// Guarda contra regresiones de balance groseras en todos los packs (objetivos en pack.json → balance).
for (const id of listPacks()) {
  it(`balance: ${id} dentro de los objetivos de win rate y duración`, () => {
    const pack = parsePack(loadPackInput(id));
    const r = simulate(pack);
    const b = balanceTargets(pack, r.factionsPerGame);
    for (const [f, st] of Object.entries(r.factions)) {
      expect(st.winRate, `${f} win rate`).toBeGreaterThanOrEqual(b.min);
      expect(st.winRate, `${f} win rate`).toBeLessThanOrEqual(b.max);
    }
    expect(r.avgTurns).toBeLessThanOrEqual(b.maxAvgTurns);
  }, 120000);
}
