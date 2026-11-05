import { edit, useStore } from '../state.ts';
import { BlurText, Check, ColorIn, ListText, Num, Section, Text } from '../ui.tsx';

const TERMS: [string, string][] = [
  ['node', 'nodo'],
  ['nodes', 'nodos'],
  ['vp', 'PV'],
  ['turnStart', 'inicio de turno'],
  ['actions', 'acciones'],
  ['close', 'cierre'],
  ['battle', 'batalla'],
  ['move', 'mover'],
  ['recruit', 'reclutar'],
  ['build', 'construir'],
  ['token', 'ficha'],
  ['effort', 'esfuerzo'],
];

export function CardsTab() {
  const cards = useStore((s) => s.draft!.cards);
  const rules = useStore((s) => s.draft!.rules);
  const meta = useStore((s) => s.draft!.pack);
  const terrains = useStore((s) => s.draft!.map.terrains);
  const nodes = useStore((s) => s.draft!.map.nodes);

  const perSuit: Record<string, number> = {};
  for (const g of cards.deck) perSuit[g.suit] = (perSuit[g.suit] ?? 0) + g.count;
  const total = Object.values(perSuit).reduce((a, b) => a + b, 0);
  const nodesPerTerrain: Record<string, number> = {};
  for (const n of nodes) nodesPerTerrain[n.terrain] = (nodesPerTerrain[n.terrain] ?? 0) + 1;
  const battle = rules.battle ?? {};
  const terms = (rules.terms ?? {}) as Record<string, string>;
  const bal = meta.balance ?? {};

  return (
    <div className="columns">
      <div>
        <Section title={`Palos (${cards.suits.length})`}>
          <table className="tbl">
            <thead>
              <tr>
                <th>id</th>
                <th>nombre</th>
                <th>color</th>
                <th>comodín</th>
                <th>cartas</th>
                <th>nodos</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cards.suits.map((s, i) => (
                <tr key={i}>
                  <td>
                    <BlurText label="" value={s.id} onCommit={(v) => void edit((d) => (d.cards.suits[i].id = v))} />
                  </td>
                  <td>
                    <Text label="" value={s.name} onChange={(v) => edit((d) => (d.cards.suits[i].name = v))} />
                  </td>
                  <td>
                    <ColorIn label="" value={s.color} onChange={(v) => edit((d) => (d.cards.suits[i].color = v))} />
                  </td>
                  <td>
                    <Check label="" value={s.wild} onChange={(v) => edit((d) => (d.cards.suits[i].wild = v))} />
                  </td>
                  <td className="num">{perSuit[s.id] ?? 0}</td>
                  <td className="num">{s.wild ? 'todos' : (nodesPerTerrain[s.id] ?? 0)}</td>
                  <td>
                    <button className="danger small" onClick={() => edit((d) => d.cards.suits.splice(i, 1))}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={() => edit((d) => d.cards.suits.push({ id: `palo${d.cards.suits.length + 1}`, name: 'Nuevo palo', color: '#888888' }))}>＋ Palo</button>
          {terrains.some((t) => !cards.suits.some((s) => s.id === t.id)) && (
            <p className="warn">Terrenos sin palo homónimo: {terrains.filter((t) => !cards.suits.some((s) => s.id === t.id)).map((t) => t.id).join(', ')}</p>
          )}
        </Section>
        <Section title={`Mazo (${total} cartas)`}>
          {cards.deck.map((g, i) => (
            <div key={i} className="row deck-row">
              <label className="field">
                <span>palo</span>
                <select value={g.suit} onChange={(e) => edit((d) => (d.cards.deck[i].suit = e.target.value))}>
                  {cards.suits.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <Num label="cantidad" value={g.count} min={1} onChange={(v) => edit((d) => (d.cards.deck[i].count = v))} />
              <ListText label="nombres (coma, en ciclo)" value={g.names} onChange={(v) => edit((d) => (d.cards.deck[i].names = v))} />
              <button className="danger small" onClick={() => edit((d) => d.cards.deck.splice(i, 1))}>
                ✕
              </button>
            </div>
          ))}
          <button onClick={() => edit((d) => d.cards.deck.push({ suit: d.cards.suits[0]?.id ?? '', count: 4, names: ['Carta'] }))}>＋ Grupo</button>
          <div className="suit-bars">
            {cards.suits.map((s) => (
              <span key={s.id} style={{ flex: perSuit[s.id] ?? 0, background: s.color }} title={`${s.name}: ${perSuit[s.id] ?? 0}`}>
                {s.name} {perSuit[s.id] ?? 0}
              </span>
            ))}
          </div>
        </Section>
      </div>
      <div>
        <Section title="Reglas generales">
          <div className="grid">
            <Num label="PV para ganar" value={rules.victoryVp} min={1} onChange={(v) => edit((d) => (d.rules.victoryVp = v))} />
            <Num label="Límite de mano" value={rules.handLimit} min={1} onChange={(v) => edit((d) => (d.rules.handLimit = v))} />
            <Num label="Mano inicial" value={rules.startingHand} min={0} onChange={(v) => edit((d) => (d.rules.startingHand = v))} />
            <Num label="Roba por turno" value={rules.drawPerTurn ?? 1} min={0} onChange={(v) => edit((d) => (d.rules.drawPerTurn = v))} />
            <Num label="Impacto con dado ≥" value={battle.hitOn ?? 4} min={1} max={6} onChange={(v) => edit((d) => (d.rules.battle = { ...d.rules.battle, hitOn: v }))} />
            <Num label="Bonus si no defiende" value={battle.undefendedBonus ?? 1} min={0} onChange={(v) => edit((d) => (d.rules.battle = { ...d.rules.battle, undefendedBonus: v }))} />
            <Num label="PV por estructura destruida" value={battle.vpPerStructure ?? 1} min={0} onChange={(v) => edit((d) => (d.rules.battle = { ...d.rules.battle, vpPerStructure: v }))} />
            <label className="field">
              <span>Esfuerzo (palo)</span>
              <select value={rules.effort?.suit ?? ''} onChange={(e) => edit((d) => (d.rules.effort = e.target.value ? { suit: e.target.value } : null))}>
                <option value="">— sin esfuerzo —</option>
                {cards.suits.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Section>
        <Section title="Vocabulario" open={false}>
          <div className="grid">
            {TERMS.map(([k, ph]) => (
              <Field2 key={k} k={k} ph={ph} value={terms[k]} />
            ))}
          </div>
        </Section>
        <Section title="Pack">
          <div className="grid">
            <Text label="Nombre" value={meta.name} onChange={(v) => edit((d) => (d.pack.name = v))} />
            <Text label="Versión" value={meta.version} onChange={(v) => edit((d) => (d.pack.version = v))} />
            <Num label="Jugadores mín." value={meta.players.min} min={1} onChange={(v) => edit((d) => (d.pack.players.min = v))} />
            <Num label="Jugadores máx." value={meta.players.max} min={1} onChange={(v) => edit((d) => (d.pack.players.max = v))} />
          </div>
          <Text label="Descripción" wide area value={meta.description} onChange={(v) => edit((d) => (d.pack.description = v))} />
        </Section>
        <Section title="Objetivos de balance">
          <div className="grid">
            <Num label="Partidas" value={bal.games ?? 300} min={10} onChange={(v) => edit((d) => (d.pack.balance = { ...d.pack.balance, games: v }))} />
            <Num label="Facciones por partida" value={bal.factionsPerGame ?? 4} min={2} onChange={(v) => edit((d) => (d.pack.balance = { ...d.pack.balance, factionsPerGame: v }))} />
            <OptRate k="minWinRate" label="Win% mín." value={bal.minWinRate} auto={0.4 / (bal.factionsPerGame ?? 4)} />
            <OptRate k="maxWinRate" label="Win% máx." value={bal.maxWinRate} auto={1.8 / (bal.factionsPerGame ?? 4)} />
            <Num label="Turnos prom. máx." value={bal.maxAvgTurns ?? 60} min={1} onChange={(v) => edit((d) => (d.pack.balance = { ...d.pack.balance, maxAvgTurns: v }))} />
          </div>
        </Section>
      </div>
    </div>
  );
}

function Field2({ k, ph, value }: { k: string; ph: string; value: string | undefined }) {
  return (
    <label className="field">
      <span>{k}</span>
      <input placeholder={ph} value={value ?? ''} onChange={(e) =>
          edit((d) => {
            const t = { ...d.rules.terms } as Record<string, string>;
            if (e.target.value) t[k] = e.target.value;
            else delete t[k];
            d.rules.terms = t;
          })
        } />
    </label>
  );
}

/** Objetivo de win% opcional: vacío = automático según facciones por partida (ver balanceTargets en core). */
function OptRate({ k, label, value, auto }: { k: 'minWinRate' | 'maxWinRate'; label: string; value: number | undefined; auto: number }) {
  return (
    <label className="field" title="Vacío = automático (0.4/k y 1.8/k con k facciones por partida)">
      <span>{label}</span>
      <input
        type="number"
        step={0.005}
        min={0}
        max={1}
        placeholder={`auto ${auto.toFixed(3)}`}
        value={value ?? ''}
        onChange={(e) =>
          edit((d) => {
            const b = { ...d.pack.balance } as Record<string, number>;
            if (e.target.value === '') delete b[k];
            else if (Number.isFinite(Number(e.target.value))) b[k] = Number(e.target.value);
            d.pack.balance = b;
          })
        }
      />
    </label>
  );
}
