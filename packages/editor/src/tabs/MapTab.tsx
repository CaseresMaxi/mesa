import { useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { analyzeMap, generateMap, type GameMap, type GamePackInput } from '@mesa/core';
import { edit, set, useStore } from '../state.ts';
import { Check, ColorIn, Num, Section, Text } from '../ui.tsx';
import type { MapInput } from '../derived.ts';

type Node = MapInput['nodes'][number];

/** Borra un nodo y reindexa todo lo que referencia ids de nodo (el id debe ser el índice). */
export function removeNode(d: GamePackInput, idx: number) {
  const m = d.map;
  const remap = (n: number) => (n > idx ? n - 1 : n);
  m.nodes.splice(idx, 1);
  m.nodes.forEach((n, i) => (n.id = i));
  m.edges = m.edges.filter(([a, b]) => a !== idx && b !== idx).map(([a, b]) => [remap(a), remap(b)] as [number, number]);
  m.startCorners = m.startCorners.filter((c) => c !== idx).map(remap);
  if (m.center !== undefined) {
    if (m.center === idx) delete m.center;
    else m.center = remap(m.center);
  }
  for (const f of d.factions) {
    if (!f.setup) continue;
    f.setup = f.setup.filter((s) => !(typeof s.at === 'object' && s.at.node === idx));
    for (const s of f.setup) if (typeof s.at === 'object') s.at = { node: remap(s.at.node) };
  }
}

function toggleEdge(m: MapInput, a: number, b: number) {
  const i = m.edges.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a));
  if (i >= 0) m.edges.splice(i, 1);
  else m.edges.push(a < b ? [a, b] : [b, a]);
}

export function MapTab() {
  const map = useStore((s) => s.draft!.map);
  const sel = useStore((s) => s.selNode);
  const [connect, setConnect] = useState(false);
  const [first, setFirst] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ id: number; x: number; z: number; moved: boolean } | null>(null);
  const [showGen, setShowGen] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const terrainColor = useMemo(() => Object.fromEntries(map.terrains.map((t) => [t.id, t.color])), [map.terrains]);
  const analysis = useMemo(() => {
    try {
      return analyzeMap(map as GameMap);
    } catch {
      return null;
    }
  }, [map]);

  const pos = (n: Node) => (drag && drag.id === n.id ? { x: drag.x, z: drag.z } : { x: n.x, z: n.z });
  const xs = map.nodes.map((n) => n.x);
  const zs = map.nodes.map((n) => n.z);
  const pad = 1.6;
  const minX = Math.min(-8, ...xs) - pad;
  const maxX = Math.max(8, ...xs) + pad;
  const minZ = Math.min(-6.5, ...zs) - pad;
  const maxZ = Math.max(6.5, ...zs) + pad;

  const toWorld = (e: RPointerEvent) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: Math.round(p.x * 10) / 10, z: Math.round(p.y * 10) / 10 };
  };

  const onNodeDown = (e: RPointerEvent, n: Node) => {
    e.stopPropagation();
    if (connect) {
      if (first === null) setFirst(n.id);
      else {
        if (first !== n.id) edit((d) => toggleEdge(d.map, first, n.id));
        setFirst(null);
      }
      set({ selNode: n.id });
      return;
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    setDrag({ id: n.id, x: n.x, z: n.z, moved: false });
    set({ selNode: n.id });
  };
  const onMove = (e: RPointerEvent) => {
    if (!drag) return;
    const p = toWorld(e);
    setDrag({ ...drag, ...p, moved: true });
  };
  const onUp = () => {
    if (drag?.moved) {
      const { id, x, z } = drag;
      edit((d) => {
        d.map.nodes[id].x = x;
        d.map.nodes[id].z = z;
      });
    }
    setDrag(null);
  };

  const node = sel !== null ? map.nodes[sel] : undefined;
  const chok = new Set(analysis?.chokepoints ?? []);
  const unit = (maxX - minX) / 100;

  return (
    <div className="split">
      <div className="canvas-wrap">
        <div className="toolbar">
          <button className={connect ? 'on' : ''} onClick={() => (setConnect(!connect), setFirst(null))} title="Clic en dos nodos para crear o borrar la conexión">
            🔗 Conectar {connect && first !== null ? `(desde ${map.nodes[first]?.name})` : ''}
          </button>
          <button
            onClick={() =>
              edit((d) => {
                const id = d.map.nodes.length;
                d.map.nodes.push({ id, name: `Nodo ${id + 1}`, terrain: d.map.terrains[0]?.id ?? 'a', slots: 1, x: 0, z: 0, corner: false });
                set({ selNode: id });
              })
            }
          >
            ＋ Nodo
          </button>
          <button onClick={() => setShowGen(true)}>🎲 Generar mapa…</button>
          <span className="muted">Arrastrá nodos para moverlos · {map.nodes.length} nodos · {map.edges.length} conexiones</span>
        </div>
        <svg ref={svgRef} className="board" viewBox={`${minX} ${minZ} ${maxX - minX} ${maxZ - minZ}`} onPointerMove={onMove} onPointerUp={onUp} onPointerDown={() => !connect && set({ selNode: null })}>
          <defs>
            <pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse">
              <path d="M1 0 L0 0 0 1" fill="none" stroke="#0001" strokeWidth={0.03} />
            </pattern>
          </defs>
          <rect x={minX} y={minZ} width={maxX - minX} height={maxZ - minZ} fill="url(#grid)" />
          {map.edges.map(([a, b], i) => {
            const A = map.nodes[a];
            const B = map.nodes[b];
            if (!A || !B) return null;
            const pa = pos(A);
            const pb = pos(B);
            const hot = sel === a || sel === b;
            return (
              <line
                key={i}
                x1={pa.x}
                y1={pa.z}
                x2={pb.x}
                y2={pb.z}
                stroke={hot ? '#c4532b' : '#5a4a3a'}
                strokeWidth={hot ? unit * 0.9 : unit * 0.55}
                strokeDasharray={`${unit * 1.6} ${unit * 0.8}`}
                strokeLinecap="round"
                className="edge"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (connect) edit((d) => toggleEdge(d.map, a, b));
                }}
              />
            );
          })}
          {map.nodes.map((n) => {
            const p = pos(n);
            const seat = map.startCorners.indexOf(n.id);
            const r = 0.72;
            return (
              <g key={n.id} transform={`translate(${p.x} ${p.z})`} className="node" onPointerDown={(e) => onNodeDown(e, n)}>
                <circle r={r + 0.12} fill="none" stroke={sel === n.id || first === n.id ? '#c4532b' : 'transparent'} strokeWidth={unit * 0.9} />
                <circle r={r} fill={terrainColor[n.terrain] ?? '#bbb'} stroke={chok.has(n.id) ? '#b00' : '#2b2118'} strokeWidth={unit * (chok.has(n.id) ? 0.9 : 0.5)} fillOpacity={0.85} />
                {Array.from({ length: n.slots }, (_, k) => (
                  <rect key={k} x={-0.22 * n.slots + k * 0.44 + 0.04} y={-0.18} width={0.36} height={0.36} fill="#fffaf0" stroke="#2b2118" strokeWidth={unit * 0.3} />
                ))}
                {n.corner && <circle r={r + 0.3} fill="none" stroke="#2b2118" strokeWidth={unit * 0.35} strokeDasharray={`${unit} ${unit}`} />}
                {seat >= 0 && (
                  <g transform={`translate(${r * 0.8} ${-r * 0.8})`}>
                    <circle r={0.3} fill="#2b2118" />
                    <text y={0.11} fontSize={0.32} textAnchor="middle" fill="#fff" fontWeight={700}>
                      {seat + 1}
                    </text>
                  </g>
                )}
                {map.center === n.id && (
                  <text y={-r - 0.15} fontSize={0.4} textAnchor="middle">
                    ✦
                  </text>
                )}
                <text y={r + 0.5} fontSize={0.42} textAnchor="middle" className="label">
                  {n.name}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="legend">
          {map.terrains.map((t) => (
            <span key={t.id}>
              <i style={{ background: t.color }} /> {t.name}
            </span>
          ))}
          <span>① esquina de inicio por asiento</span>
          <span>✦ centro</span>
          <span style={{ color: '#b00' }}>borde rojo = cuello de botella</span>
        </div>
      </div>
      <aside className="side">
        {node ? <NodePanel node={node} map={map} /> : <MapPanel map={map} />}
        {analysis && <AnalysisPanel a={analysis} map={map} />}
      </aside>
      {showGen && <GenerateDialog map={map} onClose={() => setShowGen(false)} />}
    </div>
  );
}

function NodePanel({ node, map }: { node: Node; map: MapInput }) {
  const id = node.id;
  const up = (fn: (n: Node) => void) => edit((d) => fn(d.map.nodes[id]));
  const seat = map.startCorners.indexOf(id);
  const neigh = map.edges.filter(([a, b]) => a === id || b === id).map(([a, b]) => (a === id ? b : a));
  return (
    <Section title={`Nodo #${id}: ${node.name}`} right={<button onClick={() => set({ selNode: null })}>✕</button>}>
      <Text label="Nombre" value={node.name} onChange={(v) => up((n) => (n.name = v))} />
      <label className="field">
        <span>Terreno</span>
        <select value={node.terrain} onChange={(e) => up((n) => (n.terrain = e.target.value))}>
          {map.terrains.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <Num label="Slots (edificios)" value={node.slots} min={0} max={6} onChange={(v) => up((n) => (n.slots = v))} />
      <div className="row">
        <Num label="x" value={node.x} step={0.1} onChange={(v) => up((n) => (n.x = v))} />
        <Num label="z" value={node.z} step={0.1} onChange={(v) => up((n) => (n.z = v))} />
      </div>
      <Check label="Esquina" value={node.corner} onChange={(v) => up((n) => (n.corner = v))} />
      <Check
        label={seat >= 0 ? `Inicio del asiento ${seat + 1}` : 'Esquina de inicio'}
        value={seat >= 0}
        onChange={(v) =>
          edit((d) => {
            if (v) d.map.startCorners.push(id);
            else d.map.startCorners = d.map.startCorners.filter((c) => c !== id);
          })
        }
      />
      <Check label="Nodo central (nómades)" value={map.center === id} onChange={(v) => edit((d) => (v ? (d.map.center = id) : delete d.map.center))} />
      <p className="muted">Vecinos: {neigh.map((n) => map.nodes[n]?.name).join(', ') || '—'}</p>
      <button className="danger" onClick={() => confirm(`¿Borrar "${node.name}"? Se reindexan los nodos siguientes.`) && (edit((d) => removeNode(d, id)), set({ selNode: null }))}>
        Borrar nodo
      </button>
    </Section>
  );
}

function MapPanel({ map }: { map: MapInput }) {
  return (
    <>
      <Section title="Mapa">
        <Text label="Id" value={map.id} onChange={(v) => edit((d) => (d.map.id = v))} />
        <Text label="Nombre" value={map.name} onChange={(v) => edit((d) => (d.map.name = v))} />
        <p className="muted">
          Esquinas de inicio (asiento → nodo):{' '}
          {map.startCorners.map((c, i) => (
            <span key={i} className="chip">
              {i + 1}→{map.nodes[c]?.name ?? c}
              <button title="Subir" disabled={i === 0} onClick={() => edit((d) => ([d.map.startCorners[i - 1], d.map.startCorners[i]] = [d.map.startCorners[i], d.map.startCorners[i - 1]]))}>
                ↑
              </button>
            </span>
          ))}
        </p>
        <p className="muted">Clic en un nodo para editarlo.</p>
      </Section>
      <Section title="Terrenos">
        {map.terrains.map((t, i) => (
          <div key={i} className="row terrain-row">
            <Text label="id" value={t.id} onChange={(v) => edit((d) => (d.map.terrains[i].id = v))} />
            <Text label="nombre" value={t.name} onChange={(v) => edit((d) => (d.map.terrains[i].name = v))} />
            <ColorIn label="color" value={t.color} onChange={(v) => edit((d) => (d.map.terrains[i].color = v))} />
            <button className="danger small" title="Borrar terreno" onClick={() => edit((d) => d.map.terrains.splice(i, 1))}>
              ✕
            </button>
          </div>
        ))}
        <button onClick={() => edit((d) => d.map.terrains.push({ id: `t${d.map.terrains.length + 1}`, name: 'Nuevo terreno', color: '#888888' }))}>＋ Terreno</button>
      </Section>
    </>
  );
}

function AnalysisPanel({ a, map }: { a: ReturnType<typeof analyzeMap>; map: MapInput }) {
  const name = (i: number) => map.nodes[i]?.name ?? i;
  const cd = a.cornerDistances.filter(Number.isFinite);
  const spread = cd.length ? Math.max(...cd) - Math.min(...cd) : 0;
  const tc = Object.values(a.terrainCounts);
  const tSpread = tc.length ? Math.max(...tc) - Math.min(...tc) : 0;
  const reach = a.cornerReach.map((r) => r.r2);
  const rSpread = reach.length ? Math.max(...reach) - Math.min(...reach) : 0;
  return (
    <Section title="Análisis del mapa">
      <ul className="analysis">
        <li className={a.connected ? '' : 'bad'}>{a.connected ? '✓ Conexo' : '✗ No es conexo'}</li>
        <li className={a.crossings ? 'warn' : ''}>Cruces de conexiones: {a.crossings}</li>
        <li>
          Grado: prom. {a.avgDegree} (mín {a.minDegree}, máx {a.maxDegree}) {a.avgDegree < 2.4 && <b className="warn">· poco conectado</b>}
          {a.avgDegree > 4 && <b className="warn">· muy conectado</b>}
        </li>
        <li>Diámetro: {a.diameter}</li>
        <li className={a.chokepoints.length ? 'warn' : ''}>Cuellos de botella: {a.chokepoints.length ? a.chokepoints.map(name).join(', ') : 'ninguno'}</li>
        <li className={spread > 1 ? 'warn' : ''}>
          Distancias entre esquinas: {a.cornerDistances.join(' · ') || '—'} {spread > 1 && <b>· desparejas</b>}
        </li>
        <li className={rSpread > 1 ? 'warn' : ''}>
          Territorio a ≤2 por asiento: {a.cornerReach.map((r, i) => `#${i + 1}: ${r.r2}`).join(' · ')}
        </li>
        <li className={tSpread > 1 ? 'warn' : ''}>
          Terrenos: {Object.entries(a.terrainCounts).map(([t, n]) => `${t} ${n} (${a.slotsByTerrain[t]} slots)`).join(' · ')}
        </li>
        <li>Conexiones mismo terreno: {a.sameTerrainEdges}</li>
      </ul>
    </Section>
  );
}

function GenerateDialog({ map, onClose }: { map: MapInput; onClose: () => void }) {
  const [seed, setSeed] = useState(1);
  const [nodes, setNodes] = useState(map.nodes.length);
  const [corners, setCorners] = useState(Math.min(4, map.startCorners.length || 4));
  const [avgDegree, setAvg] = useState(3.1);
  const preview = useMemo(
    () => generateMap({ seed, nodes, corners, avgDegree, terrains: map.terrains as GameMap['terrains'], names: map.nodes.map((n) => n.name), id: map.id, name: map.name }),
    [seed, nodes, corners, avgDegree, map],
  );
  const a = analyzeMap(preview);
  const col = Object.fromEntries(map.terrains.map((t) => [t.id, t.color]));
  return (
    <div className="modal" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Generar mapa</h3>
        <div className="row">
          <Num label="Semilla" value={seed} onChange={setSeed} />
          <button onClick={() => setSeed(Math.floor(Math.random() * 1e6))}>🎲</button>
          <Num label="Nodos" value={nodes} min={4} max={30} onChange={setNodes} />
          <Num label="Esquinas" value={corners} min={1} max={4} onChange={setCorners} />
          <Num label="Grado prom." value={avgDegree} step={0.1} min={2} max={5} onChange={setAvg} />
        </div>
        <svg viewBox="-8.5 -7 17 14" className="preview">
          {preview.edges.map(([x, y], i) => (
            <line key={i} x1={preview.nodes[x].x} y1={preview.nodes[x].z} x2={preview.nodes[y].x} y2={preview.nodes[y].z} stroke="#5a4a3a" strokeWidth={0.08} />
          ))}
          {preview.nodes.map((n) => (
            <g key={n.id}>
              <circle cx={n.x} cy={n.z} r={0.55} fill={col[n.terrain]} stroke="#2b2118" strokeWidth={0.06} />
              {preview.startCorners.includes(n.id) && (
                <text x={n.x} y={n.z + 0.15} fontSize={0.45} textAnchor="middle" fill="#fff">
                  {preview.startCorners.indexOf(n.id) + 1}
                </text>
              )}
            </g>
          ))}
        </svg>
        <p className="muted">
          {a.edges} conexiones · grado {a.avgDegree} · diámetro {a.diameter} · esquinas a {a.cornerDistances.join('/')} · cruces {a.crossings}
        </p>
        <p className="muted">Reemplaza nodos, conexiones, esquinas y centro. Se conservan los nombres y terrenos definidos. Si hay setups con nodos fijos, revisalos.</p>
        <div className="row end">
          <button onClick={onClose}>Cancelar</button>
          <button
            className="primary"
            onClick={() => {
              edit((d) => {
                d.map.nodes = preview.nodes;
                d.map.edges = preview.edges;
                d.map.startCorners = preview.startCorners;
                d.map.center = preview.center;
              });
              set({ selNode: null });
              onClose();
            }}
          >
            Usar este mapa
          </button>
        </div>
      </div>
    </div>
  );
}
