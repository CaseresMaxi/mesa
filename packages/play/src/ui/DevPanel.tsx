import { formatIssues } from '@mesa/core';
import { useMemo, useState } from 'react';
import { moveLabel } from '../interaction.ts';
import { replay, useSession, type SaveFile } from '../session.ts';

/** Herramientas de desarrollo: estado, moves legales, historial, bots, saves y problemas del pack. */
export function DevPanel() {
  const st = useSession();
  const { engine, full, view, history, role, issues, usingDraft, godView, botDelay, botsPaused, set, send, restart, stepBot, exportSave, loadSave, seats } = st;
  const [tab, setTab] = useState<'moves' | 'history' | 'state' | 'pack'>('moves');
  const [scrub, setScrub] = useState<number | null>(null);
  const s = full ?? view;
  const legal = useMemo(() => (engine && s && s.phase !== 'fin' ? engine.legalMoves(s) : []), [engine, s]);
  const authority = role !== 'peer';

  const scrubbed = useMemo(() => {
    if (scrub === null || !engine || !full) return null;
    return replay(engine, full.seed, seats, history.slice(0, scrub)).state;
  }, [scrub, engine, full, seats, history]);

  const download = () => {
    const save = exportSave();
    if (!save) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(save, null, 2)], { type: 'application/json' }));
    a.download = `${save.pack}-${save.seed}-t${full?.turn ?? 0}.mesa-save.json`;
    a.click();
  };
  const upload = (f: File | undefined) => f && f.text().then((t) => loadSave(JSON.parse(t) as SaveFile));

  return (
    <aside className="dev">
      <div className="devhead">
        <b>🛠 Desarrollo</b>
        {usingDraft && <span className="pill warn">borrador del editor</span>}
        {issues.length > 0 && <span className="pill warn">{issues.length} aviso(s)</span>}
        <span className="grow" />
        <button onClick={() => set({ devOpen: false })}>✕</button>
      </div>
      {authority && (
        <div className="devrow">
          <label>
            <input type="checkbox" checked={godView} onChange={(e) => set({ godView: e.target.checked })} /> ver todo
          </label>
          <label>
            <input type="checkbox" checked={botsPaused} onChange={(e) => set({ botsPaused: e.target.checked })} /> pausar bots
          </label>
          <button onClick={stepBot} title="El bot juega un move por el jugador actual (aunque sea humano)">🤖 paso</button>
          <label>
            demora{' '}
            <select value={botDelay} onChange={(e) => set({ botDelay: Number(e.target.value) })}>
              {[0, 100, 300, 500, 1000, 2000].map((d) => (
                <option key={d} value={d}>
                  {d} ms
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {authority && (
        <div className="devrow">
          <button onClick={restart}>↺ Reiniciar (misma semilla)</button>
          <button onClick={download}>⬇ Save</button>
          <label className="file">
            ⬆ Cargar <input type="file" accept=".json" onChange={(e) => upload(e.target.files?.[0])} />
          </label>
          <span className="muted">semilla {full?.seed}</span>
        </div>
      )}
      <nav className="devtabs">
        {(['moves', 'history', 'state', 'pack'] as const).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {{ moves: `Moves (${legal.length})`, history: `Historial (${history.length})`, state: 'Estado', pack: 'Pack' }[t]}
          </button>
        ))}
      </nav>
      <div className="devbody">
        {tab === 'moves' && s && engine && (
          <ul className="moves">
            {legal.map((m, i) => (
              <li key={i}>
                <button disabled={!authority && view?.factions[view.order[view.current]].seat !== st.mySeat} onClick={() => send(m)}>
                  ▶
                </button>{' '}
                <b>{moveLabel(engine, s, m.type)}</b> <code>{JSON.stringify(m)}</code>
              </li>
            ))}
          </ul>
        )}
        {tab === 'history' && (
          <>
            {authority && history.length > 0 && (
              <div className="devrow">
                <input type="range" min={0} max={history.length} value={scrub ?? history.length} onChange={(e) => setScrub(Number(e.target.value))} />
                <span className="muted">{scrub ?? history.length}/{history.length}</span>
                {scrub !== null && <button onClick={() => setScrub(null)}>volver</button>}
              </div>
            )}
            {scrubbed && <pre className="json small">{JSON.stringify({ turn: scrubbed.turn, vp: Object.fromEntries(scrubbed.order.map((f) => [f, scrubbed.factions[f].vp])), nodes: scrubbed.nodes }, null, 1)}</pre>}
            <ol className="moves">
              {history.map((h, i) => (
                <li key={i} className={scrub !== null && i >= scrub ? 'muted' : ''}>
                  <span className="muted">#{h.seat + 1}</span> <code>{JSON.stringify(h.move)}</code>
                </li>
              ))}
            </ol>
          </>
        )}
        {tab === 'state' && <pre className="json">{JSON.stringify(s, (k, v) => (k === 'log' ? `[${(v as unknown[]).length} entradas]` : v), 1)}</pre>}
        {tab === 'pack' && <pre className="json">{issues.length ? formatIssues(issues) : '✓ Pack sin avisos'}{'\n\n'}Facciones: {engine?.pack.factions.map((f) => f.id).join(', ')}</pre>}
      </div>
    </aside>
  );
}
