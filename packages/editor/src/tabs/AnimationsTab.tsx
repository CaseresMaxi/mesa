import { collectAssets, renderAsset, type ResolvedAsset } from '@mesa/art';
import { allClips, BUILTIN_CLIPS, clipDuration, FxClip, FxStep, sampleBattle, stepApplies, type GamePack } from '@mesa/core';
import { BattleFx, totalDuration } from '@mesa/fx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.ts';
import { validated } from '../derived.ts';
import { loadArtFonts } from '../fonts.ts';
import { edit, useStore } from '../state.ts';
import { Check, JsonEditor, Num, Section } from '../ui.tsx';

type Outcome = Parameters<typeof sampleBattle>[2];
const OUTCOMES: { id: NonNullable<Outcome>; label: string }[] = [
  { id: 'gana', label: 'gana el atacante' },
  { id: 'pierde', label: 'gana el defensor' },
  { id: 'empate', label: 'empate' },
  { id: 'sin-defensa', label: 'sin defensa' },
];
const FX_KINDS = FxStep.options.map((o) => o.shape.fx.value);
const WHEN = ['always', 'attackerWins', 'defenderWins', 'draw', 'undefended', 'attackerLost', 'defenderLost', 'noLosses'] as const;
const FX_COLOR: Record<string, string> = { lunge: '#c0703a', shake: '#8a6d3b', flash: '#d4b13c', projectile: '#3b7ac0', burst: '#d0533b', ring: '#7a5cc0', dice: '#3b9a6d', casualties: '#a03030', text: '#555' };

/** URLs de assets renderizados a demanda (rough.js es caro: se cachean por pack). */
function useAssetUrl(pack: GamePack | null) {
  const [ready, setReady] = useState(false);
  useEffect(() => void loadArtFonts().then(() => setReady(true)), []);
  return useMemo(() => {
    const byId = new Map<string, ResolvedAsset>(pack ? collectAssets(pack).map((a) => [a.id, a]) : []);
    const urls = new Map<string, string | null>();
    return (id: string) => {
      if (!pack || !ready) return null;
      if (!urls.has(id)) {
        const a = byId.get(id);
        urls.set(id, a && !a.file ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderAsset(pack, a))}` : a?.file ? api.fileUrl(pack.pack.id, a.file) : null);
      }
      return urls.get(id)!;
    };
  }, [pack, ready]);
}

export function AnimationsTab() {
  const draft = useStore((s) => s.draft!);
  const { pack } = validated(draft);
  const anim = draft.animations ?? {};
  const own = (anim.clips ?? {}) as Record<string, unknown>;
  const clips = pack ? allClips(pack.animations) : BUILTIN_CLIPS;
  const factions = draft.factions.map((f) => ({ id: f.id, name: f.name, color: f.color }));
  const [sel, setSel] = useState<string>(Object.keys(own)[0] ?? 'clasico');
  const [att, setAtt] = useState(factions[0]?.id ?? '');
  const [def, setDef] = useState(factions[1]?.id ?? factions[0]?.id ?? '');
  const [outcome, setOutcome] = useState<NonNullable<Outcome>>('gana');
  const [speed, setSpeed] = useState(1);
  const asset = useAssetUrl(pack);

  const editable = sel in own;
  const clip = clips[sel] ?? BUILTIN_CLIPS.clasico;
  const battle = useMemo(() => sampleBattle(att, def, outcome), [att, def, outcome]);
  const total = totalDuration(clip);

  // reloj de la vista previa
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [loop, setLoop] = useState(true);
  const raf = useRef(0);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now: number) => {
      setT((x) => {
        const n = x + (now - last) * speed;
        if (n < total) return n;
        if (loop) return 0;
        setPlaying(false);
        return total;
      });
      last = now;
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, speed, total, loop]);
  useEffect(() => setT(0), [sel, outcome, att, def]);

  const setAnim = (fn: (a: Record<string, any>) => void) =>
    edit((d) => {
      const a = ((d as any).animations ??= {});
      fn(a);
    });
  const setSteps = (steps: unknown[]) => setAnim((a) => ((a.clips ??= {})[sel] = { ...(a.clips[sel] ?? {}), steps }));
  const rawSteps = (editable ? ((own[sel] as { steps?: unknown[] }).steps ?? []) : clip.steps) as Record<string, unknown>[];
  const copyToPack = (name: string) => {
    let n = name;
    for (let i = 2; n in own; i++) n = `${name}-${i}`;
    setAnim((a) => ((a.clips ??= {})[n] = structuredClone({ description: clips[name]?.description ?? '', steps: clips[name]?.steps ?? [] })));
    setSel(n);
  };
  const byAttacker = (anim.battle?.byAttacker ?? {}) as Record<string, string>;
  const color = (side: 'attacker' | 'defender') => factions.find((f) => f.id === (side === 'attacker' ? att : def))?.color ?? '#888';
  const clipEnd = clipDuration(clip.steps);

  return (
    <div className="split">
      <div>
        <Section
          title="Vista previa"
          right={
            <span className="muted small">
              {Math.round(t)} / {total} ms
            </span>
          }
        >
          <svg viewBox="0 0 1000 520" className="fx-stage">
            <rect width={1000} height={520} fill={pack?.assets.style.paper ?? '#f4ead2'} />
            <circle cx={500} cy={330} r={84} fill="#d8c9a2" stroke="#2b2118" strokeWidth={4} />
            <text x={500} y={445} textAnchor="middle" fontFamily="Caveat" fontSize={34}>
              {pack?.map.nodes[0]?.name ?? 'nodo'}
            </text>
            {pack && att && def && (
              <BattleFx
                battle={battle}
                clip={clip}
                x={500}
                y={330}
                hitOn={pack.rules.battle.hitOn}
                color={color}
                names={{ attacker: pack.factions.find((f) => f.id === att)?.short ?? att, defender: pack.factions.find((f) => f.id === def)?.short ?? def, node: pack.map.nodes[0]?.name ?? '' }}
                asset={asset}
                time={t}
              />
            )}
          </svg>
          <div className="toolbar">
            <button onClick={() => (t >= total && setT(0), setPlaying(!playing))}>{playing ? '⏸' : '▶'}</button>
            <input type="range" min={0} max={total} value={t} onChange={(e) => (setPlaying(false), setT(Number(e.target.value)))} style={{ flex: 1 }} />
            <Check label="loop" value={loop} onChange={setLoop} />
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              {[0.1, 0.25, 0.5, 1, 2].map((v) => (
                <option key={v} value={v}>
                  ×{v}
                </option>
              ))}
            </select>
          </div>
          <div className="toolbar">
            <label>
              ataca{' '}
              <select value={att} onChange={(e) => setAtt(e.target.value)}>
                {factions.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              defiende{' '}
              <select value={def} onChange={(e) => setDef(e.target.value)}>
                {factions.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            {OUTCOMES.map((o) => (
              <button key={o.id} className={outcome === o.id ? 'on' : ''} onClick={() => setOutcome(o.id)}>
                {o.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title={`Línea de tiempo · ${sel}${editable ? '' : ' (incorporado, sólo lectura)'}`} right={!editable && <button onClick={() => copyToPack(sel)}>Copiar al pack para editar</button>}>
          <div className="fx-timeline" style={{ height: clip.steps.length * 20 + 6 }} onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setPlaying(false);
            setT(((e.clientX - r.left) / r.width) * total);
          }}>
            {clip.steps.map((s, i) => {
              const on = stepApplies(s.when, battle);
              return (
                <div key={i} className="fx-bar" title={`${s.fx} · ${s.at}–${s.at + s.dur} ms · ${s.when}`} style={{ left: `${(s.at / total) * 100}%`, width: `${(s.dur / total) * 100}%`, top: i * 20, background: FX_COLOR[s.fx], opacity: on ? 1 : 0.3 }}>
                  {s.fx}
                  {s.when !== 'always' ? ` · ${s.when}` : ''}
                </div>
              );
            })}
            <div className="fx-end" style={{ left: `${(clipEnd / total) * 100}%`, height: clip.steps.length * 20 }} />
            <div className="fx-head" style={{ left: `${(t / total) * 100}%`, height: clip.steps.length * 20 }} />
          </div>
          <p className="muted small">Atenuado = no corre con este resultado (condición "when"). Click en la línea para saltar a ese momento.</p>

          <table className="tbl fx-steps">
            <thead>
              <tr>
                <th>efecto</th>
                <th>at</th>
                <th>dur</th>
                <th>cuándo</th>
                <th>parámetros</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rawSteps.map((s, i) => {
                const upd = (p: Record<string, unknown>) => setSteps(rawSteps.map((x, j) => (j === i ? { ...x, ...p } : x)));
                const { fx, at, dur, when, ...rest } = s;
                return (
                  <tr key={i}>
                    <td>
                      <select disabled={!editable} value={String(fx)} onChange={(e) => setSteps(rawSteps.map((x, j) => (j === i ? { fx: e.target.value, at, dur, when } : x)))}>
                        {FX_KINDS.map((k) => (
                          <option key={k}>{k}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input disabled={!editable} type="number" step={50} value={Number(at ?? 0)} onChange={(e) => upd({ at: Number(e.target.value) })} style={{ width: 70 }} />
                    </td>
                    <td>
                      <input disabled={!editable} type="number" step={50} value={Number(dur ?? 400)} onChange={(e) => upd({ dur: Number(e.target.value) })} style={{ width: 70 }} />
                    </td>
                    <td>
                      <select disabled={!editable} value={String(when ?? 'always')} onChange={(e) => upd({ when: e.target.value })}>
                        {WHEN.map((w) => (
                          <option key={w}>{w}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <ParamsInput disabled={!editable} value={rest} onCommit={(p) => setSteps(rawSteps.map((x, j) => (j === i ? { fx, at, dur, when, ...p } : x)))} fx={String(fx)} />
                    </td>
                    <td className="nowrap">
                      {editable && (
                        <>
                          <button title="Subir" disabled={i === 0} onClick={() => setSteps(rawSteps.map((x, j) => (j === i - 1 ? rawSteps[i] : j === i ? rawSteps[i - 1] : x)))}>
                            ↑
                          </button>
                          <button title="Duplicar" onClick={() => setSteps([...rawSteps.slice(0, i + 1), structuredClone(s), ...rawSteps.slice(i + 1)])}>
                            ⧉
                          </button>
                          <button title="Quitar" disabled={rawSteps.length <= 1} onClick={() => setSteps(rawSteps.filter((_, j) => j !== i))}>
                            ✕
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {editable && (
            <div className="row">
              {FX_KINDS.map((k) => (
                <button key={k} onClick={() => setSteps([...rawSteps, k === 'text' ? { fx: k, at: Math.round(t), dur: 600, text: '¡Pum!' } : { fx: k, at: Math.round(t), dur: 400 }])}>
                  + {k}
                </button>
              ))}
            </div>
          )}
        </Section>
      </div>

      <div className="side wide-side">
        <Section title="Clips">
          <div className="fx-clips">
            {Object.keys(clips).map((name) => (
              <button key={name} className={name === sel ? 'on' : ''} onClick={() => setSel(name)}>
                <b>{name}</b> <small>{name in own ? (name in BUILTIN_CLIPS ? 'del pack (pisa al incorporado)' : 'del pack') : 'incorporado'} · {clipDuration(clips[name].steps)} ms</small>
                <span>{clips[name].description || '—'}</span>
              </button>
            ))}
          </div>
          <div className="row">
            <button onClick={() => copyToPack(sel)}>Duplicar «{sel}» en el pack</button>
            {editable && (
              <>
                <button
                  onClick={() => {
                    const n = prompt('Nuevo nombre del clip', sel)?.trim();
                    if (!n || n === sel || !/^[a-z0-9][a-z0-9_-]*$/.test(n)) return;
                    setAnim((a) => {
                      a.clips[n] = a.clips[sel];
                      delete a.clips[sel];
                      const b = a.battle ?? {};
                      if (b.default === sel) b.default = n;
                      for (const f in b.byAttacker ?? {}) if (b.byAttacker[f] === sel) b.byAttacker[f] = n;
                    });
                    setSel(n);
                  }}
                >
                  Renombrar
                </button>
                <button onClick={() => confirm(`¿Borrar el clip «${sel}»?`) && (setAnim((a) => delete a.clips[sel]), setSel('clasico'))}>Borrar</button>
              </>
            )}
          </div>
          {editable && (
            <label className="field">
              <span>Descripción</span>
              <input value={String((own[sel] as { description?: string }).description ?? '')} onChange={(e) => setAnim((a) => (a.clips[sel].description = e.target.value))} />
            </label>
          )}
        </Section>

        <Section title="Qué clip usa cada pelea">
          <label className="field">
            <span>Por defecto</span>
            <select value={anim.battle?.default ?? ''} onChange={(e) => setAnim((a) => ((a.battle ??= {}).default = e.target.value))}>
              <option value="">clasico (incorporado)</option>
              {Object.keys(clips).map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <table className="tbl">
            <tbody>
              {factions.map((f) => (
                <tr key={f.id}>
                  <td>
                    <span className="dot" style={{ background: f.color }} /> {f.name}
                  </td>
                  <td>
                    <select
                      value={byAttacker[f.id] ?? ''}
                      onChange={(e) =>
                        setAnim((a) => {
                          const b = ((a.battle ??= {}).byAttacker ??= {});
                          if (e.target.value) b[f.id] = e.target.value;
                          else delete b[f.id];
                        })
                      }
                    >
                      <option value="">(por defecto)</option>
                      {Object.keys(clips).map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button title="Ver en la vista previa" onClick={() => (setAtt(f.id), setSel(byAttacker[f.id] || anim.battle?.default || 'clasico'))}>
                      👁
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="General">
          <Check label="Animar peleas en este juego" value={anim.enabled ?? true} onChange={(v) => setAnim((a) => (a.enabled = v))} />
          <Num label="Velocidad global" value={anim.speed ?? 1} step={0.1} min={0.1} max={10} onChange={(v) => setAnim((a) => (a.speed = v))} />
        </Section>

        {editable && (
          <Section title="JSON del clip" open={false}>
            <JsonEditor value={own[sel]} schema={FxClip} rows={14} onCommit={(v) => setAnim((a) => (a.clips[sel] = v))} />
          </Section>
        )}
      </div>
    </div>
  );
}

/** Parámetros propios de cada efecto como `clave=valor` (lo que no son at/dur/when). */
const HINT: Record<string, string> = {
  lunge: 'who=attacker dist=60 ease=back',
  shake: 'who=defender amp=10',
  flash: 'who=defender color=#ffffff',
  projectile: 'from=attacker shape=bolt count=3 arc=60 color=attacker asset=token-x',
  burst: 'who=defender color=attacker count=16 radius=90',
  ring: 'who=node color=#ffffff radius=140',
  dice: 'size=46',
  casualties: '',
  text: 'text="{ah} – {dh}" size=44 color=attacker',
};
function ParamsInput({ value, onCommit, disabled, fx }: { value: Record<string, unknown>; onCommit(v: Record<string, unknown>): void; disabled: boolean; fx: string }) {
  const fmt = (v: Record<string, unknown>) =>
    Object.entries(v)
      .map(([k, x]) => `${k}=${typeof x === 'string' && /\s/.test(x) ? JSON.stringify(x) : String(x)}`)
      .join(' ');
  const [txt, setTxt] = useState(fmt(value));
  const [bad, setBad] = useState(false);
  useEffect(() => setTxt(fmt(value)), [JSON.stringify(value)]);
  const commit = () => {
    const out: Record<string, unknown> = {};
    for (const m of txt.matchAll(/(\w+)=("(?:[^"\\]|\\.)*"|\S+)/g)) {
      const raw = m[2];
      out[m[1]] = raw.startsWith('"') ? JSON.parse(raw) : raw === 'true' || raw === 'false' ? raw === 'true' : raw !== '' && !Number.isNaN(Number(raw)) && !raw.startsWith('#') ? Number(raw) : raw;
    }
    const ok = FxStep.safeParse({ fx, ...out }).success;
    setBad(!ok);
    if (ok) onCommit(out);
  };
  return <input disabled={disabled} className={bad ? 'bad' : ''} value={txt} placeholder={HINT[fx]} title={HINT[fx]} onChange={(e) => setTxt(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} style={{ width: '100%', minWidth: 260 }} />;
}
