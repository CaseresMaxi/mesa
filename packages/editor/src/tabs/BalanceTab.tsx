import { useEffect, useMemo, useRef, useState } from 'react';
import { applyPatch, balanceTargets, hasPath, pct, type GamePackInput, type SimReport } from '@mesa/core';
import { api } from '../api.ts';
import { validated } from '../derived.ts';
import { runSim } from '../sim.ts';
import { getState, toast, useStore } from '../state.ts';
import { Bar, Num, Section } from '../ui.tsx';

const SOURCE_COLORS = ['#3f8fc4', '#e0a82e', '#c4532b', '#10a37f', '#6a5acd', '#c2448f', '#7a7f88', '#8fb339', '#d9822b', '#4b6584'];
function sourceColor(src: string, all: string[]) {
  return SOURCE_COLORS[all.indexOf(src) % SOURCE_COLORS.length];
}

export function BalanceTab() {
  const packId = useStore((s) => s.packId!);
  const draft = useStore((s) => s.draft!);
  const base = useStore((s) => s.base!);
  const { pack } = validated(draft);
  const [games, setGames] = useState(150);
  const [fpg, setFpg] = useState<number>(pack?.pack.balance.factionsPerGame ?? 4);
  const [report, setReport] = useState<SimReport | null>(null);
  const [baseReport, setBaseReport] = useState<SimReport | null>(null);
  const [baseline, setBaseline] = useState<SimReport | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const cancels = useRef<(() => void)[]>([]);

  useEffect(() => {
    api
      .report(packId, 'baseline')
      .then(setBaseline)
      .catch(() => setBaseline(null));
    return () => cancels.current.forEach((c) => c());
  }, [packId]);

  const opts = { games, factionsPerGame: fpg };
  const go = async (label: string, jobs: { input: GamePackInput; set: (r: SimReport) => void }[]) => {
    setRunning(label);
    try {
      const runs = jobs.map((j) => runSim(j.input, opts));
      cancels.current = runs.map((r) => r.cancel);
      const reps = await Promise.all(runs.map((r) => r.promise));
      reps.forEach((r, i) => jobs[i].set(r));
    } catch (e) {
      if ((e as Error).message !== 'cancelado') toast(`Simulación: ${(e as Error).message}`, 'error');
    } finally {
      setRunning(null);
      cancels.current = [];
    }
  };

  const colors = Object.fromEntries(draft.factions.map((f) => [f.id, f.color]));
  const names = Object.fromEntries(draft.factions.map((f) => [f.id, f.short]));

  return (
    <div className="balance">
      <div className="toolbar">
        <label className="field inline">
          <span>Partidas</span>
          <select value={games} onChange={(e) => setGames(Number(e.target.value))}>
            {[50, 150, 300, 600].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <Num label="Facciones/partida" value={fpg} min={2} max={6} onChange={setFpg} />
        <button className="primary" disabled={!pack || !!running} onClick={() => go('borrador', [{ input: draft, set: setReport }])}>
          ▶ Simular borrador
        </button>
        <button disabled={!pack || !!running} onClick={() => go('comparación', [{ input: base, set: setBaseReport }, { input: draft, set: setReport }])} title="Corre la misma simulación sobre lo guardado en disco y sobre el borrador">
          ⇄ Comparar base vs borrador
        </button>
        {running && (
          <>
            <span className="spin">Simulando {running}…</span>
            <button onClick={() => cancels.current.forEach((c) => c())}>Cancelar</button>
          </>
        )}
        <span className="spacer" />
        <button
          disabled={!report}
          onClick={() =>
            report &&
            api
              .saveReport(packId, 'baseline', report)
              .then(() => (setBaseline(report), toast('Guardado como baseline (reports/baseline.json)')))
              .catch((e: Error) => toast(e.message, 'error'))
          }
        >
          Guardar como baseline
        </button>
      </div>
      {pack && (
        <p className="muted">
          Objetivos ({fpg} facciones/partida): win% entre {pct(balanceTargets(pack, fpg).min)} y {pct(balanceTargets(pack, fpg).max)} · ≤ {pack.pack.balance.maxAvgTurns} turnos promedio.
        </p>
      )}
      {!pack && <p className="warn">El borrador tiene errores de validación: no se puede simular.</p>}
      {baseline && <p className="muted">Baseline cargado: {baseline.games} partidas · Δ se calcula contra {baseReport ? 'la base recién simulada' : 'el baseline'}.</p>}
      <div className="columns">
        {baseReport && <ReportView title="Base (disco)" r={baseReport} cmp={null} colors={colors} names={names} />}
        {report ? (
          <ReportView title={baseReport ? 'Borrador' : 'Resultado'} r={report} cmp={baseReport ?? baseline} colors={colors} names={names} />
        ) : (
          !baseReport && <div className="empty">Corré una simulación: {games} partidas entre bots codiciosos, rotando combinaciones de facciones y asientos.</div>
        )}
      </div>
      {pack && <Sweep games={games} fpg={fpg} colors={colors} />}
    </div>
  );
}

function ReportView({ title, r, cmp, colors, names }: { title: string; r: SimReport; cmp: SimReport | null; colors: Record<string, string>; names: Record<string, string> }) {
  const rows = Object.entries(r.factions).sort((a, b) => b[1].winRate - a[1].winRate);
  const allSources = [...new Set(rows.flatMap(([, s]) => Object.keys(s.vpSources)))].sort();
  const maxVp = Math.max(1, ...rows.map(([, s]) => Object.values(s.vpSources).reduce((a, b) => a + b, 0)));
  return (
    <Section title={`${title}: ${r.games} partidas · ${r.avgTurns} turnos prom. · ${r.stalls} bloqueos · ${(r.ms / 1000).toFixed(1)} s`}>
      <table className="tbl report">
        <thead>
          <tr>
            <th>facción</th>
            <th>victorias</th>
            <th>Δ</th>
            <th>PV prom.</th>
            <th>fuentes de PV</th>
            <th>win% por asiento</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([f, s]) => {
            const c = cmp?.factions[f];
            const d = c ? (s.winRate - c.winRate) * 100 : null;
            return (
              <tr key={f}>
                <td>
                  <i className="dot" style={{ background: colors[f] }} /> {names[f] ?? f}
                </td>
                <td className="winrate">
                  <Bar value={s.winRate} max={0.6} color={colors[f]} /> {pct(s.winRate)} <small>({s.wins}/{s.played})</small>
                </td>
                <td className={d === null ? '' : Math.abs(d) < 2 ? 'muted' : d > 0 ? 'up' : 'down'}>{d === null ? '' : `${d > 0 ? '+' : ''}${d.toFixed(1)}`}</td>
                <td className="num">{s.avgVp}</td>
                <td>
                  <span className="stack" title={Object.entries(s.vpSources).map(([k, v]) => `${k}: ${v}`).join('\n')}>
                    {Object.entries(s.vpSources)
                      .sort()
                      .map(([k, v]) => (
                        <span key={k} style={{ width: `${(v / maxVp) * 100}%`, background: sourceColor(k, allSources) }} />
                      ))}
                  </span>
                </td>
                <td className="seats">{s.seatWinRate.map((x) => pct(x)).join(' · ')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="legend">
        {allSources.map((k) => (
          <span key={k}>
            <i style={{ background: sourceColor(k, allSources) }} /> {k}
          </span>
        ))}
      </div>
      <p className="muted">Asientos: {r.seatWinRate.map((x, i) => `#${i + 1} ${pct(x)}`).join(' · ')}</p>
      {r.warnings.length ? (
        <ul className="warnings">
          {r.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      ) : (
        <p className="good">✓ Dentro de los objetivos de balance.</p>
      )}
    </Section>
  );
}

/** Rutas numéricas de una facción (para el barrido de parámetros). */
function numericPaths(obj: unknown, base: string): string[] {
  if (typeof obj === 'number') return [base];
  if (Array.isArray(obj)) return obj.every((x) => typeof x === 'number') ? obj.map((_, i) => `${base}/${i}`) : [];
  if (obj && typeof obj === 'object') return Object.entries(obj).flatMap(([k, v]) => (k === 'setup' || k === 'onClose' || k === 'onTurnStart' || k === 'special' ? [] : numericPaths(v, `${base}/${k}`)));
  return [];
}

const EXTRA_PATHS = ['/battle/maxDice', '/battle/defenseBonus', '/battle/vpPerWarriorKill', '/move/range', '/actions'];

function Sweep({ games, fpg, colors }: { games: number; fpg: number; colors: Record<string, string> }) {
  const draft = useStore((s) => s.draft!);
  const sel = useStore((s) => s.selFaction);
  const [faction, setFaction] = useState(sel ?? draft.factions[0]?.id);
  const f = draft.factions.find((x) => x.id === faction) ?? draft.factions[0];
  const paths = useMemo(() => {
    const own = numericPaths(f, `/factions/${f.id}`);
    const extra = EXTRA_PATHS.map((p) => `/factions/${f.id}${p}`).filter((p) => !own.includes(p));
    const rules = ['/rules/victoryVp', '/rules/handLimit', '/rules/startingHand', '/rules/drawPerTurn'];
    return [...own, ...extra, ...rules];
  }, [f]);
  const [path, setPath] = useState(paths[0]);
  const [values, setValues] = useState('');
  const [rows, setRows] = useState<{ v: number; r: SimReport }[]>([]);
  const [busy, setBusy] = useState(false);
  const p = paths.includes(path) ? path : paths[0];

  const run = async () => {
    const vals = values
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
    if (!vals.length) return toast('Poné valores separados por coma, ej. 16, 18, 20', 'error');
    setBusy(true);
    setRows([]);
    try {
      const d = getState().draft!;
      const inputs = vals.map((v) => applyPatch(d, [{ op: hasPath(d, p) ? 'replace' : 'add', path: p, value: v }]));
      for (const inp of inputs) if (!validated(inp).pack) throw new Error('Algún valor deja el pack inválido');
      const reps = await Promise.all(inputs.map((inp) => runSim(inp, { games, factionsPerGame: fpg }).promise));
      setRows(vals.map((v, i) => ({ v, r: reps[i] })));
    } catch (e) {
      toast(`Barrido: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Barrido de parámetro">
      <div className="toolbar">
        <label className="field inline">
          <span>Facción</span>
          <select value={f.id} onChange={(e) => setFaction(e.target.value)}>
            {draft.factions.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field inline">
          <span>Ruta</span>
          <select value={p} onChange={(e) => setPath(e.target.value)}>
            {paths.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label className="field inline">
          <span>Valores</span>
          <input placeholder="ej. 16, 18, 20" value={values} onChange={(e) => setValues(e.target.value)} />
        </label>
        <button disabled={busy} onClick={run}>
          {busy ? 'Corriendo…' : '▶ Barrer'}
        </button>
        <span className="muted">{games} partidas por valor, en paralelo</span>
      </div>
      {rows.length > 0 && (
        <table className="tbl">
          <thead>
            <tr>
              <th>valor</th>
              {Object.keys(rows[0].r.factions).map((k) => (
                <th key={k} style={{ color: colors[k] }}>
                  {k}
                </th>
              ))}
              <th>turnos</th>
              <th>avisos</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ v, r }) => (
              <tr key={v}>
                <td className="num">
                  <b>{v}</b>
                </td>
                {Object.entries(r.factions).map(([k, s]) => (
                  <td key={k} className={k === f.id ? 'hl num' : 'num'}>
                    {pct(s.winRate)}
                  </td>
                ))}
                <td className="num">{r.avgTurns}</td>
                <td className="muted">{r.warnings.length || '✓'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}
