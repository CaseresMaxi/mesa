import { useState } from 'react';
import { DEV } from '../packSource.ts';
import { useSession, type Seat } from '../session.ts';

export function Menu({ packs, onPack, draftAvailable }: { packs: { id: string; name: string }[]; onPack(id: string, draft: boolean): void; draftAvailable: boolean }) {
  const { pack, packId, usingDraft, name, setName, startLocal, createRoom, joinRoom } = useSession();
  const [code, setCode] = useState(new URLSearchParams(location.search).get('room') ?? '');
  return (
    <div className="menu">
      <h1>{pack?.pack.name ?? 'mesa'}</h1>
      {pack && <p className="muted">{pack.pack.description}</p>}
      {DEV && (
        <div className="row">
          <label>
            Pack{' '}
            <select value={packId ?? ''} onChange={(e) => onPack(e.target.value, false)}>
              {packs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {draftAvailable && (
            <label>
              <input type="checkbox" checked={usingDraft} onChange={(e) => packId && onPack(packId, e.target.checked)} /> usar borrador del editor
            </label>
          )}
        </div>
      )}
      <label>
        Tu nombre <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jugador" />
      </label>
      <div className="row">
        <button className="primary" onClick={startLocal}>
          Partida local (hotseat + bots)
        </button>
        <button onClick={createRoom}>Crear sala online</button>
      </div>
      <div className="row">
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CÓDIGO" maxLength={6} />
        <button disabled={!code} onClick={() => joinRoom(code)}>
          Unirme
        </button>
      </div>
      <p className="muted small">Online P2P sin servidor (WebRTC). El host corre el motor y le manda el pack a los demás.</p>
    </div>
  );
}

export function Lobby() {
  const { pack, engine, seats, setSeats, seed, setSeed, role, room, startGame, leave, claimSeat, playerId, peers } = useSession();
  if (!pack || !engine) return <div className="menu">Esperando el pack del host…</div>;
  const host = role !== 'peer';
  const max = Math.min(pack.pack.players.max, pack.map.startCorners.length);
  const upd = (i: number, p: Partial<Seat>) => setSeats(seats.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const free = (i: number) => pack.factions.find((f) => !seats.some((s, j) => j !== i && s.faction === f.id))?.id;
  const link = room ? `${location.origin}${location.pathname}?room=${room}` : '';
  return (
    <div className="menu lobby">
      <h2>{pack.pack.name} · {role === 'local' ? 'partida local' : `sala ${room}`}</h2>
      {room && (
        <p>
          Compartí: <code>{link}</code> <button onClick={() => navigator.clipboard.writeText(link)}>Copiar</button> · {peers} conectado(s)
        </p>
      )}
      <table>
        <tbody>
          {seats.map((s, i) => {
            const f = engine.factions[s.faction];
            return (
              <tr key={i}>
                <td>#{i + 1}</td>
                <td>
                  <span className="dot" style={{ background: f?.color }} />
                  <select disabled={!host} value={s.faction} onChange={(e) => upd(i, { faction: e.target.value })}>
                    {pack.factions.map((x) => (
                      <option key={x.id} value={x.id} disabled={seats.some((o, j) => j !== i && o.faction === x.id)}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input disabled={!host} value={s.name} placeholder={f?.short} onChange={(e) => upd(i, { name: e.target.value })} />
                </td>
                <td>
                  {host ? (
                    <select value={s.kind} disabled={!!s.ownerId && s.ownerId !== playerId} onChange={(e) => upd(i, { kind: e.target.value as Seat['kind'] })}>
                      <option value="human">humano</option>
                      <option value="bot">bot</option>
                    </select>
                  ) : s.ownerId === playerId ? (
                    'vos'
                  ) : (
                    <button onClick={() => claimSeat(i)}>Sentarme</button>
                  )}
                  {s.ownerId && <span className="muted"> {s.connected ? '🟢' : '⚪'}</span>}
                </td>
                <td>{host && seats.length > pack.pack.players.min && <button onClick={() => setSeats(seats.filter((_, j) => j !== i))}>✕</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {host && (
        <div className="row">
          {seats.length < max && (
            <button onClick={() => free(seats.length) && setSeats([...seats, { faction: free(seats.length)!, name: `Bot ${seats.length}`, kind: 'bot', ownerId: null, connected: false }])}>
              + asiento
            </button>
          )}
          <label>
            semilla <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) >>> 0)} />
          </label>
          <button onClick={() => setSeed((Math.random() * 1e9) >>> 0)}>🎲</button>
        </div>
      )}
      <div className="row">
        {host && (
          <button className="primary" onClick={startGame}>
            Empezar
          </button>
        )}
        <button onClick={leave}>Volver</button>
      </div>
    </div>
  );
}
