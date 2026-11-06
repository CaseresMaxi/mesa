import type { Card, GameView, Move } from '@mesa/core';
import { useEffect, useMemo, useState } from 'react';
import { assetUrl } from '../assets.ts';
import { candidates, FIELD_PROMPT, moveLabel, nextField, options, settle, type MoveType, type Selection } from '../interaction.ts';
import { useSession } from '../session.ts';
import { Board } from './Board.tsx';
import { DevPanel } from './DevPanel.tsx';

export function Game() {
  const { pack, engine, view, mySeat, canUndo, send, undo, role, seats, devOpen, fxOn, set, leave } = useSession();
  const [sel, setSel] = useState<Selection | null>(null);
  const [discard, setDiscard] = useState<number[]>([]);
  const [focus, setFocus] = useState<number | null>(null);

  const myTurn = !!view && view.phase !== 'fin' && mySeat !== null && view.factions[view.order[view.current]]?.seat === mySeat;
  // los moves legales se calculan sobre la vista: sólo cambia que no conocemos manos ajenas (no hacen falta)
  const legal = useMemo(() => (engine && view && myTurn ? engine.legalMoves(view) : []), [engine, view, myTurn]);
  useEffect(() => {
    setSel(null);
    setDiscard([]);
  }, [view?.moveCount, view?.turn]);

  if (!pack || !engine || !view) return null;
  const cur = view.order[view.current];
  const curDef = engine.factions[cur];
  const me = mySeat !== null ? view.order.find((f) => view.factions[f].seat === mySeat) : undefined;
  const hand: Card[] = me ? view.factions[me].hand : [];

  const pick = (s: Selection) => {
    const r = settle(legal, s);
    if (r.move) {
      send(r.move);
      setSel(null);
    } else setSel(r.sel);
  };
  const field = sel ? nextField(sel) : null;
  const opts = sel && field ? options(legal, sel, field) : [];
  const nodeField = field === 'from' || field === 'to' || field === 'node';
  const types = [...new Set(legal.map((m) => m.type))].filter((t) => t !== 'descartar') as MoveType[];

  const onNode = (id: number) => {
    if (sel && nodeField && opts.includes(id)) return pick({ ...sel, [field!]: id });
    setFocus(id === focus ? null : id);
  };
  const onCard = (c: Card) => {
    if (view.phase === 'descarte' && myTurn) return setDiscard((d) => (d.includes(c.id) ? d.filter((x) => x !== c.id) : [...d, c.id]));
    if (sel && field === 'card' && opts.includes(c.id)) pick({ ...sel, card: c.id });
  };
  const need = me ? view.factions[me].hand.length - pack.rules.handLimit : 0;
  const discardMove: Move = { type: 'descartar', cards: discard };
  const discardErr = view.phase === 'descarte' && myTurn ? engine.validateMove(view, mySeat!, discardMove) : null;

  const winner = view.winner ? engine.factions[view.winner] : null;
  const focusMoves = focus !== null ? legal.filter((m) => ('node' in m && m.node === focus) || ('from' in m && m.from === focus)) : [];

  return (
    <div className={`game${devOpen ? ' with-dev' : ''}`}>
      <header className="bar">
        <b>{pack.pack.name}</b>
        <span className="turn" style={{ borderColor: curDef.color }}>
          Turno {view.turn} · <span style={{ color: curDef.color }}>●</span> {view.factions[cur].playerName} ({curDef.short})
          {curDef.archetype === 'standard' && view.phase === 'dia' ? ` · ${view.actionsLeft} acción(es)` : ''}
        </span>
        <span className="grow" />
        {role !== 'local' && <span className="pill">{role === 'host' ? 'Host' : 'Conectado'}</span>}
        {pack.animations.enabled && (
          <button onClick={() => set({ fxOn: !fxOn })} title="Animaciones de las peleas">
            🎬 <small>{fxOn ? 'anim.' : 'sin anim.'}</small>
          </button>
        )}
        <button onClick={() => set({ devOpen: !devOpen })} title="Panel de desarrollo (tecla `)">🛠 Dev</button>
        <button onClick={leave}>Salir</button>
      </header>

      <main className="table">
        <div className="board-wrap">
          <Board pack={pack} view={view} highlight={nodeField ? (opts as number[]) : []} selected={[sel?.from, sel?.node, focus].filter((x): x is number => typeof x === 'number')} onNode={onNode} ruler={(n) => engine.ruler(view, n)} />
          {winner && (
            <div className="winner">
              🏆 {winner.name} gana con {view.factions[winner.id].vp} {pack.rules.terms.vp}
            </div>
          )}
        </div>
        <aside className="side">
          <Factions view={view} />
          {focus !== null && <NodeInfo id={focus} view={view} moves={focusMoves.length} />}
          <Log view={view} />
        </aside>
      </main>

      <footer className="controls">
        <div className="actions">
          {!myTurn && view.phase !== 'fin' && (
            <span className="hint">Esperando a {view.factions[cur].playerName}{seats[view.factions[cur].seat]?.kind === 'bot' ? ' (bot)' : ''}…</span>
          )}
          {myTurn && view.phase === 'descarte' && (
            <>
              <span className="hint">Descartá {need} carta(s) — elegilas en la mano</span>
              <button className="primary" disabled={!!discardErr} onClick={() => send(discardMove)}>
                Descartar {discard.length}/{need}
              </button>
            </>
          )}
          {myTurn && view.phase === 'dia' && !sel &&
            types.map((t) => (
              <button key={t} className={t === 'terminarDia' ? 'end' : ''} onClick={() => pick({ type: t })}>
                {moveLabel(engine, view, t)} <small>{candidates(legal, { type: t }).length}</small>
              </button>
            ))}
          {sel && (
            <>
              <b>{moveLabel(engine, view, sel.type)}:</b>
              <span className="hint">{field ? FIELD_PROMPT[field] : ''}</span>
              {field === 'count' && opts.map((o) => <button key={o} onClick={() => pick({ ...sel, count: o })}>{o}</button>)}
              {field === 'target' &&
                opts.map((o) => (
                  <button key={o} onClick={() => pick({ ...sel, target: o })} style={{ borderColor: engine.factions[o as string]?.color }}>
                    {engine.factions[o as string]?.short ?? o}
                  </button>
                ))}
              <button onClick={() => setSel(null)}>Cancelar</button>
            </>
          )}
          {canUndo && <button onClick={undo}>↶ Deshacer</button>}
        </div>
        <div className="hand">
          {hand.map((c) => {
            const playable = (sel && field === 'card' && opts.includes(c.id)) || (view.phase === 'descarte' && myTurn);
            const url = assetUrl(pack, `card-${slugify(c.name)}`);
            return (
              <button key={c.id} className={`card${playable ? ' playable' : ''}${discard.includes(c.id) ? ' chosen' : ''}`} onClick={() => onCard(c)} title={`${c.name} (${c.suit})`}>
                {url ? <img src={url} alt={c.name} /> : c.name}
              </button>
            );
          })}
          {!hand.length && <span className="hint">{me ? 'Sin cartas' : 'Espectador'}</span>}
        </div>
      </footer>
      {devOpen && <DevPanel />}
    </div>
  );
}

function slugify(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function Factions({ view }: { view: GameView }) {
  const { engine, pack } = useSession();
  if (!engine || !pack) return null;
  return (
    <div className="factions">
      {view.order.map((f) => {
        const d = engine.factions[f];
        const fs = view.factions[f];
        const close = engine.closingScore(view, f).filter((r) => r.vp > 0);
        const cur = view.order[view.current] === f;
        return (
          <details key={f} className={`faction${cur ? ' current' : ''}`} style={{ borderColor: d.color }}>
            <summary>
              <span className="dot" style={{ background: d.color }} />
              <b>{d.short}</b> <span className="muted">{fs.playerName}</span>
              <span className="vp">
                {fs.vp}/{pack.rules.victoryVp} {pack.rules.terms.vp}
              </span>
              <div className="vpbar">
                <i style={{ width: `${Math.min(100, (fs.vp / pack.rules.victoryVp) * 100)}%`, background: d.color }} />
              </div>
            </summary>
            <div className="fbody">
              <div className="muted">
                🃏 {view.handCounts[f]} · {d.warriors.name} {fs.warriorsSupply} en reserva
                {d.building ? ` · ${d.building.name.toLowerCase()}s ${fs.buildingsSupply}` : ''}
                {d.token ? ` · ${d.token.name.toLowerCase()}s ${fs.tokensSupply}` : ''}
              </div>
              {fs.items && (
                <div className="items">
                  {fs.items.map((it, i) => (
                    <span key={i} className={it.exhausted ? 'burnt' : ''}>
                      {d.nomad?.items.find((x) => x.id === it.kind)?.name ?? it.kind}
                    </span>
                  ))}
                </div>
              )}
              {close.length > 0 && <div className="muted">{pack.rules.terms.close} ahora: {close.map((r) => `+${r.vp} ${r.why}`).join(' · ')}</div>}
              <ul>{d.summary.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          </details>
        );
      })}
    </div>
  );
}

function NodeInfo({ id, view, moves }: { id: number; view: GameView; moves: number }) {
  const { pack, engine } = useSession();
  if (!pack || !engine) return null;
  const n = pack.map.nodes[id];
  const g = view.nodes[id];
  const r = engine.ruler(view, id);
  return (
    <div className="nodeinfo">
      <b>{n.name}</b> <span className="muted">· {pack.map.terrains.find((t) => t.id === n.terrain)?.name} · {n.slots} slot(s)</span>
      <div className="muted">
        Gobierna: {r ? engine.factions[r].short : 'nadie'} · vecinos: {engine.neighbors(id).map((x) => pack.map.nodes[x].name).join(', ')}
      </div>
      <div className="muted">
        {Object.entries(g.warriors).map(([f, k]) => `${engine.factions[f]?.short} ${k}`).join(' · ') || 'sin guerreros'}
        {moves ? ` · ${moves} move(s) posibles acá` : ''}
      </div>
    </div>
  );
}

function Log({ view }: { view: GameView }) {
  const { engine } = useSession();
  return (
    <div className="log">
      {[...view.log].reverse().slice(0, 80).map((e) => (
        <div key={e.seq} style={{ borderColor: e.faction ? engine?.factions[e.faction]?.color : 'transparent' }}>
          <span className="muted">t{e.turn}</span> {e.text}
        </div>
      ))}
    </div>
  );
}
