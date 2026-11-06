import { FxClip, type Animations, type FxStep, type FxWhen, type GamePack } from './schema.ts';
import type { BattleResult, FactionId } from './state.ts';

/**
 * Clips incorporados: sirven si el pack no define los suyos, y como punto de partida para copiar.
 * Un pack los puede pisar definiendo un clip con el mismo nombre en `animations.json`.
 */
const RAW: Record<string, unknown> = {
  clasico: {
    description: 'Embestida, dados, impacto y bajas. Sirve para cualquier facción.',
    steps: [
      { fx: 'lunge', at: 0, dur: 450, who: 'attacker', dist: 70, ease: 'back' },
      { fx: 'dice', at: 150, dur: 900 },
      { fx: 'shake', at: 450, dur: 350, who: 'defender', amp: 12, when: 'attackerWins' },
      { fx: 'flash', at: 450, dur: 250, who: 'defender', color: '#ffffff' },
      { fx: 'burst', at: 450, dur: 600, who: 'defender', color: 'attacker', count: 14 },
      { fx: 'lunge', at: 700, dur: 400, who: 'defender', dist: 40, when: 'attackerLost' },
      { fx: 'flash', at: 900, dur: 250, who: 'attacker', color: '#ffffff', when: 'attackerLost' },
      { fx: 'casualties', at: 1050, dur: 900 },
      { fx: 'text', at: 1100, dur: 900, text: '{ah} – {dh}', size: 48 },
    ],
  },
  disparo: {
    description: 'A distancia: ráfaga de proyectiles con el color del atacante.',
    steps: [
      { fx: 'dice', at: 0, dur: 800 },
      { fx: 'projectile', at: 200, dur: 550, from: 'attacker', shape: 'bolt', count: 4, arc: 30 },
      { fx: 'ring', at: 700, dur: 500, who: 'defender', color: 'attacker', radius: 110 },
      { fx: 'shake', at: 700, dur: 300, who: 'defender', amp: 10 },
      { fx: 'projectile', at: 800, dur: 500, from: 'defender', shape: 'orb', count: 2, arc: 50, when: 'attackerLost' },
      { fx: 'casualties', at: 1150, dur: 900 },
      { fx: 'text', at: 1200, dur: 800, text: '{ah} – {dh}', size: 44 },
    ],
  },
  emboscada: {
    description: 'Golpe rápido contra un lugar sin defensa.',
    steps: [
      { fx: 'lunge', at: 0, dur: 350, who: 'attacker', dist: 110, ease: 'in' },
      { fx: 'ring', at: 300, dur: 450, who: 'node', color: 'attacker', radius: 170 },
      { fx: 'burst', at: 300, dur: 700, who: 'node', color: 'attacker', count: 24, radius: 130 },
      { fx: 'casualties', at: 500, dur: 800 },
      { fx: 'text', at: 500, dur: 900, text: '¡Emboscada!', size: 46, color: 'attacker' },
    ],
  },
};

export const BUILTIN_CLIPS: Record<string, FxClip> = Object.fromEntries(Object.entries(RAW).map(([k, v]) => [k, FxClip.parse(v)]));

/** Todos los clips disponibles para el pack (incorporados + propios; los propios pisan). */
export function allClips(anim: Animations): Record<string, FxClip> {
  return { ...BUILTIN_CLIPS, ...anim.clips };
}

/** Nombre del clip que corresponde a una pelea. */
export function battleClipName(anim: Animations, attacker: FactionId): string {
  return anim.battle.byAttacker[attacker] || anim.battle.default || 'clasico';
}

export function battleClip(pack: GamePack, attacker: FactionId): FxClip {
  const clips = allClips(pack.animations);
  return clips[battleClipName(pack.animations, attacker)] ?? BUILTIN_CLIPS.clasico;
}

/** Todo lo que perdió un bando: guerreros, estructuras y componentes (nómade). */
export const lossCount = (l: BattleResult['attackerLosses']) => l.warriors + l.structures + (l.items ?? 0);

/** ¿Corre este paso con este resultado? */
export function stepApplies(when: FxWhen, b: BattleResult): boolean {
  const aLoss = lossCount(b.attackerLosses);
  const dLoss = lossCount(b.defenderLosses);
  switch (when) {
    case 'always':
      return true;
    case 'attackerWins':
      return dLoss > aLoss;
    case 'defenderWins':
      return aLoss > dLoss;
    case 'draw':
      return aLoss === dLoss;
    case 'undefended':
      return b.defenderWarriors === 0;
    case 'attackerLost':
      return aLoss > 0;
    case 'defenderLost':
      return dLoss > 0;
    case 'noLosses':
      return aLoss + dLoss === 0;
  }
}

/** Duración total del clip (ms, antes de aplicar `speed`). */
export function clipDuration(steps: FxStep[]): number {
  return steps.reduce((m, s) => Math.max(m, s.at + s.dur), 0);
}

/** Pelea de ejemplo para previsualizar clips (editor, tests). */
export function sampleBattle(attacker: FactionId, defender: FactionId, outcome: 'gana' | 'pierde' | 'empate' | 'sin-defensa' = 'gana', node = 0): BattleResult {
  const base = { seq: 0, node, attacker, defender };
  switch (outcome) {
    case 'gana':
      return { ...base, attackerRolls: [5, 4, 2], defenderRolls: [3, 1], attackerHits: 2, defenderHits: 0, attackerWarriors: 3, defenderWarriors: 2, attackerLosses: { warriors: 0, structures: 0 }, defenderLosses: { warriors: 2, structures: 0 } };
    case 'pierde':
      return { ...base, attackerRolls: [2, 1], defenderRolls: [6, 5, 4], attackerHits: 0, defenderHits: 2, attackerWarriors: 2, defenderWarriors: 3, attackerLosses: { warriors: 2, structures: 0 }, defenderLosses: { warriors: 0, structures: 0 } };
    case 'empate':
      return { ...base, attackerRolls: [5, 2], defenderRolls: [4, 1], attackerHits: 1, defenderHits: 1, attackerWarriors: 2, defenderWarriors: 2, attackerLosses: { warriors: 1, structures: 0 }, defenderLosses: { warriors: 1, structures: 0 } };
    case 'sin-defensa':
      return { ...base, attackerRolls: [6, 3], defenderRolls: [], attackerHits: 2, defenderHits: 0, attackerWarriors: 2, defenderWarriors: 0, attackerLosses: { warriors: 0, structures: 0 }, defenderLosses: { warriors: 0, structures: 1 } };
  }
}
