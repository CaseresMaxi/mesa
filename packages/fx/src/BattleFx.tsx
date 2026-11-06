import { useEffect, useRef, useState } from 'react';
import { frameAt, totalDuration, type FxContext, type Side, type Sprite } from './timeline.ts';

export interface BattleFxProps extends FxContext {
  /** URL de un asset del pack (null si no existe). */
  asset(id: string): string | null;
  /** Velocidad (1 = normal). */
  speed?: number;
  /** Rectángulo a oscurecer alrededor de la pelea (normalmente, el tablero entero). */
  dim?: { w: number; h: number };
  /** Zoom de la escena alrededor del nodo (1 = tamaño del tablero). */
  zoom?: number;
  /** Instante fijo (ms): el editor lo usa para el scrub. Sin esto, se reproduce sola. */
  time?: number;
  onDone?(): void;
}

const FIG_W = 84;
const FIG_H = 104;

/** Reproduce la animación de una pelea como un <g> de SVG, en coordenadas del tablero. */
export function BattleFx(props: BattleFxProps) {
  const { speed = 1, time, onDone } = props;
  const [now, setNow] = useState(0);
  const done = useRef(false);
  const total = totalDuration(props.clip);

  useEffect(() => {
    if (time !== undefined) return;
    done.current = false;
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const t = (performance.now() - t0) * speed;
      setNow(t);
      if (t >= total) {
        if (!done.current) ((done.current = true), onDone?.());
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // se reinicia con cada pelea nueva
  }, [props.battle, props.clip, time === undefined, speed]);

  const t = time ?? now;
  const f = frameAt(props, t);
  const fid = (c: string) => `fx-tint-${c.replace('#', '')}`;
  const tints = [...new Set(f.figures.flatMap((x) => (x.tint ? [x.tint.color] : [])))];
  const warrior = (side: Side) => props.asset(`warrior-${side === 'attacker' ? props.battle.attacker : props.battle.defender}`);

  return (
    <g className="battle-fx" opacity={f.opacity} pointerEvents="none">
      <defs>
        {tints.map((c) => (
          <filter key={c} id={fid(c)}>
            <feFlood floodColor={c} />
            <feComposite in2="SourceAlpha" operator="in" />
          </filter>
        ))}
        <radialGradient id="fx-arena">
          <stop offset="0" stopColor="#fff8e4" stopOpacity="0.85" />
          <stop offset="1" stopColor="#fff8e4" stopOpacity="0" />
        </radialGradient>
      </defs>
      {props.dim && <rect width={props.dim.w} height={props.dim.h} fill="#2b2118" opacity={0.28} />}
      <g transform={`translate(${props.x} ${props.y}) scale(${props.zoom ?? 1}) translate(${-props.x} ${-props.y})`}>
        <ellipse cx={props.x} cy={props.y - 40} rx={330} ry={190} fill="url(#fx-arena)" />
        {f.figures.map((fig, i) => {
          const url = warrior(fig.side);
          const flip = fig.side === 'defender' ? -1 : 1;
          const tf = `translate(${fig.x} ${fig.y}) rotate(${fig.rot}) scale(${flip} 1)`;
          return (
            <g key={i} transform={tf} opacity={fig.opacity}>
              <ellipse cx={0} cy={0} rx={30} ry={8} fill="#000" opacity={0.22} />
              {url ? (
                <>
                  <image href={url} x={-FIG_W / 2} y={-FIG_H} width={FIG_W} height={FIG_H} />
                  {fig.tint && fig.tint.k > 0.02 && <image href={url} x={-FIG_W / 2} y={-FIG_H} width={FIG_W} height={FIG_H} filter={`url(#${fid(fig.tint.color)})`} opacity={fig.tint.k * 0.85} />}
                </>
              ) : (
                <circle cx={0} cy={-40} r={30} fill={props.color(fig.side)} stroke="#2b2118" strokeWidth={3} />
              )}
            </g>
          );
        })}
        {f.sprites.map((s, i) => (
          <SpriteEl key={i} s={s} asset={props.asset} color={props.color} />
        ))}
      </g>
    </g>
  );
}

function SpriteEl({ s, asset, color }: { s: Sprite; asset: BattleFxProps['asset']; color: BattleFxProps['color'] }) {
  switch (s.kind) {
    case 'particle':
      return <circle cx={s.x} cy={s.y} r={s.r} fill={s.color} opacity={s.opacity} stroke="#2b2118" strokeWidth={1} />;
    case 'ring':
      return <circle cx={s.x} cy={s.y} r={s.r} fill="none" stroke={s.color} strokeWidth={s.width} opacity={s.opacity} />;
    case 'image': {
      const url = asset(s.asset);
      if (!url) return null;
      return <image href={url} x={-s.size / 2} y={-s.size / 2} width={s.size} height={s.size} opacity={s.opacity} transform={`translate(${s.x} ${s.y}) rotate(${s.rot})`} />;
    }
    case 'shape':
      return (
        <g transform={`translate(${s.x} ${s.y}) rotate(${s.rot})`} opacity={s.opacity}>
          <Shape shape={s.shape} size={s.size} color={s.color} />
        </g>
      );
    case 'die': {
      const url = asset(`die-${s.value}`);
      const half = s.size / 2;
      return (
        <g transform={`translate(${s.x} ${s.y}) rotate(${s.rot})`} opacity={s.opacity}>
          {s.hit && <rect x={-half - 6} y={-half - 6} width={s.size + 12} height={s.size + 12} rx={12} fill={color(s.side)} opacity={0.75} />}
          {url ? (
            <image href={url} x={-half} y={-half} width={s.size} height={s.size} />
          ) : (
            <>
              <rect x={-half} y={-half} width={s.size} height={s.size} rx={9} fill="#fffaf0" stroke="#2b2118" strokeWidth={3} />
              <text y={s.size * 0.18} textAnchor="middle" fontSize={s.size * 0.55} fontWeight={700} fill="#2b2118">
                {s.value}
              </text>
            </>
          )}
        </g>
      );
    }
    case 'text':
      return (
        <text
          transform={`translate(${s.x} ${s.y}) scale(${s.scale})`}
          textAnchor="middle"
          fontFamily="Caveat, cursive"
          fontWeight={700}
          fontSize={s.size}
          fill={s.color}
          opacity={s.opacity}
          paintOrder="stroke"
          stroke="#fffaf0"
          strokeWidth={7}
        >
          {s.text}
        </text>
      );
  }
}

function Shape({ shape, size, color }: { shape: 'orb' | 'bolt' | 'arrow' | 'star'; size: number; color: string }) {
  const r = size / 2;
  switch (shape) {
    case 'orb':
      return (
        <>
          <circle r={r * 1.6} fill={color} opacity={0.25} />
          <circle r={r} fill={color} stroke="#2b2118" strokeWidth={2} />
          <circle cx={-r * 0.3} cy={-r * 0.3} r={r * 0.3} fill="#fff" opacity={0.7} />
        </>
      );
    case 'bolt':
      return (
        <path
          d={`M${-r * 1.6} ${-r * 0.4} L${r * 0.2} ${-r * 0.5} L${-r * 0.1} ${-r * 0.1} L${r * 1.6} 0 L${-r * 0.2} ${r * 0.5} L0 ${r * 0.1} Z`}
          fill={color}
          stroke="#2b2118"
          strokeWidth={2}
          strokeLinejoin="round"
        />
      );
    case 'arrow':
      return (
        <>
          <line x1={-r * 1.8} y1={0} x2={r} y2={0} stroke="#2b2118" strokeWidth={3} />
          <path d={`M${r * 1.6} 0 L${r * 0.6} ${-r * 0.5} L${r * 0.6} ${r * 0.5} Z`} fill={color} stroke="#2b2118" strokeWidth={2} />
          <path d={`M${-r * 1.8} 0 l-${r * 0.4} -${r * 0.4} M${-r * 1.8} 0 l-${r * 0.4} ${r * 0.4}`} stroke={color} strokeWidth={3} />
        </>
      );
    case 'star': {
      const pts = Array.from({ length: 10 }, (_, k) => {
        const a = (k * Math.PI) / 5 - Math.PI / 2;
        const rr = k % 2 ? r * 0.45 : r;
        return `${Math.cos(a) * rr},${Math.sin(a) * rr}`;
      }).join(' ');
      return <polygon points={pts} fill={color} stroke="#2b2118" strokeWidth={2} strokeLinejoin="round" />;
    }
  }
}
