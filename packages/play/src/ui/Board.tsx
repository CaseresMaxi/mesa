import type { GamePack, GameView } from '@mesa/core';
import { assetUrl, BOARD_H, BOARD_W, boardXY } from '../assets.ts';

interface Props {
  pack: GamePack;
  view: GameView;
  /** Nodos resaltados (opciones válidas del campo actual). */
  highlight: number[];
  selected: number[];
  onNode(id: number): void;
  ruler: (node: number) => string | null;
}

/** Tablero: el SVG pintado del pack de fondo + piezas superpuestas en las posiciones de los nodos. */
export function Board({ pack, view, highlight, selected, onNode, ruler }: Props) {
  const at = boardXY(pack);
  const bg = assetUrl(pack, 'board');
  const color = (f: string) => pack.factions.find((x) => x.id === f)?.color ?? '#888';
  const R = 84;
  const last = view.lastBattle;
  return (
    <svg className="board" viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} preserveAspectRatio="xMidYMid meet">
      {bg && <image href={bg} x={0} y={0} width={BOARD_W} height={BOARD_H} />}
      {pack.map.nodes.map((n) => {
        const [x, y] = at(n.x, n.z);
        const g = view.nodes[n.id];
        const r = ruler(n.id);
        const hl = highlight.includes(n.id);
        const sel = selected.includes(n.id);
        const warriors = Object.entries(g.warriors).filter(([, k]) => k > 0);
        const sz = 30;
        return (
          <g key={n.id} className={`node${hl ? ' hl' : ''}${sel ? ' sel' : ''}`} onClick={() => onNode(n.id)}>
            <circle cx={x} cy={y} r={R + 10} className="hit" />
            {r && <circle cx={x} cy={y} r={R + 4} fill="none" stroke={color(r)} strokeWidth={8} strokeDasharray="18 10" opacity={0.85} />}
            {hl && <circle cx={x} cy={y} r={R + 16} className="ring" />}
            {sel && <circle cx={x} cy={y} r={R + 16} className="ring sel" />}
            {g.buildings.map((b, i) => {
              const sx = x - ((n.slots - 1) * (sz + 10)) / 2 + i * (sz + 10);
              const url = assetUrl(pack, `building-${b.faction}`);
              return url ? <image key={i} href={url} x={sx - 19} y={y + 0} width={38} height={38} /> : null;
            })}
            {g.tokens.map((t, i) => {
              const url = assetUrl(pack, `token-${t.faction}`);
              return url ? <image key={i} href={url} x={x - R - 34 + i * 20} y={y - 30} width={60} height={60} /> : null;
            })}
            {warriors.map(([f, k], i) => {
              const url = assetUrl(pack, `warrior-${f}`);
              // figuras en fila sobre el borde superior del nodo, para no tapar slots ni nombre
              const wx = x - ((warriors.length - 1) * 62) / 2 + i * 62;
              const wy = y - R - 52;
              return (
                <g key={f} className="warrior">
                  <ellipse cx={wx} cy={wy + 84} rx={24} ry={6} fill="#000" opacity={0.18} />
                  {url && <image href={url} x={wx - 32} y={wy} width={64} height={80} />}
                  <circle cx={wx + 24} cy={wy + 72} r={17} fill={color(f)} stroke="#2b2118" strokeWidth={2.5} />
                  <text x={wx + 24} y={wy + 79} textAnchor="middle" className="count">
                    {k}
                  </text>
                </g>
              );
            })}
            {last && last.node === n.id && view.moveCount - last.seq < 2 && (
              <text x={x} y={y + R + 70} textAnchor="middle" className="dice">
                🎲 {last.attackerRolls.join(' ')} vs {last.defenderRolls.join(' ') || '—'}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
