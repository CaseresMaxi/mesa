import { useEffect, useState } from 'react';
import { applyBatch, describeOp, itemId, newBatch, type BatchItem } from '@mesa/core';
import { api, download, slug, type BatchSummary } from '../api.ts';
import { diffToBatch, dirtyOps, editBatch, getState, replaceDraft, set, toast, useStore } from '../state.ts';
import { Section } from '../ui.tsx';

type Intent = Extract<BatchItem, { kind: 'intent' }>;
const VERIFY = ['validate', 'sim', 'assets', 'visual'] as const;

export function BatchTab() {
  const packId = useStore((s) => s.packId!);
  const batch = useStore((s) => s.batch!);
  const batchName = useStore((s) => s.batchName);
  const draft = useStore((s) => s.draft);
  const [list, setList] = useState<BatchSummary[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const dirty = draft ? dirtyOps().length : 0;

  const refresh = () => api.batches(packId).then(setList).catch(() => setList([]));
  useEffect(() => void refresh(), [packId]);

  const name = batchName ?? slug(batch.title);
  const save = async () => {
    try {
      const r = await api.saveBatch(packId, name, batch);
      set({ batchName: name });
      toast(`Lote guardado en ${r.path}`);
      void refresh();
    } catch (e) {
      toast(`No se pudo guardar el lote: ${(e as Error).message}`, 'error');
    }
  };
  const applyNow = () => {
    const d = getState().draft!;
    const r = applyBatch(d, batch);
    if (r.failed.length) toast(`Fallaron ${r.failed.length}: ${r.failed.map((f) => f.error).join('; ')}`, 'error');
    if (r.applied.length) {
      replaceDraft(r.pack);
      editBatch((b) => b.items.forEach((it) => r.applied.includes(it.id) && (it.status = 'applied')));
      toast(`${r.applied.length} patch(es) aplicados al borrador. Revisá y guardá en disco.`);
    } else if (!r.failed.length) toast('No hay patches pendientes');
  };
  const move = (i: number, d: -1 | 1) =>
    editBatch((b) => {
      const j = i + d;
      if (j < 0 || j >= b.items.length) return;
      [b.items[i], b.items[j]] = [b.items[j], b.items[i]];
    });
  const cmd = `/aplicar-lote packs/${packId}/batches/${name}.json`;
  const pending = batch.items.filter((i) => i.status === 'pending').length;

  return (
    <div className="split batch">
      <div className="form">
        <Section title="Lote actual">
          <div className="grid">
            <label className="field">
              <span>Título</span>
              <input value={batch.title} onChange={(e) => editBatch((b) => (b.title = e.target.value))} />
            </label>
            <label className="field">
              <span>Archivo</span>
              <input value={name} onChange={(e) => set({ batchName: slug(e.target.value) })} />
            </label>
          </div>
          <label className="field">
            <span>Notas generales para quien procese el lote</span>
            <textarea className="wide" rows={2} value={batch.notes ?? ''} onChange={(e) => editBatch((b) => (b.notes = e.target.value))} />
          </label>
          <div className="row">
            <button onClick={() => (diffToBatch(true) ? toast('Cambios del borrador convertidos en items') : toast('No hay cambios en el borrador'))} disabled={!dirty} title="Pasa el diff base→borrador al lote y vuelve el borrador a lo que hay en disco">
              ⤵ Convertir cambios en lote ({dirty})
            </button>
            <button onClick={applyNow} disabled={!batch.items.some((i) => i.kind === 'patch' && i.status === 'pending')}>
              ✓ Aplicar patches ahora
            </button>
            <button className="primary" onClick={save}>
              💾 Guardar lote
            </button>
            <button onClick={() => download(`${name}.json`, JSON.stringify(batch, null, 2) + '\n')}>⬇ Exportar .json</button>
            <button onClick={() => confirm('¿Empezar un lote nuevo? (el actual no guardado se pierde)') && set({ batch: newBatch(packId, 'Lote sin título'), batchName: null })}>Nuevo</button>
          </div>
        </Section>

        <Section title={`Items (${batch.items.length}, ${pending} pendientes)`}>
          {batch.items.length === 0 && <p className="muted">Vacío. Editá en las otras pestañas y tocá “Convertir cambios en lote”, o agregá una intención para la IA.</p>}
          {batch.items.map((it, i) => (
            <div key={it.id} className={`item ${it.kind} ${it.status}`}>
              <div className="item-head">
                <span className="kind">{it.kind === 'patch' ? '⚙ patch' : '💬 intención'}</span>
                <input className="title-in" value={it.title} onChange={(e) => editBatch((b) => (b.items[i].title = e.target.value))} />
                <select value={it.status} onChange={(e) => editBatch((b) => (b.items[i].status = e.target.value as BatchItem['status']))}>
                  <option value="pending">pendiente</option>
                  <option value="applied">aplicado</option>
                  <option value="rejected">rechazado</option>
                </select>
                <button onClick={() => move(i, -1)} disabled={i === 0}>
                  ↑
                </button>
                <button onClick={() => move(i, 1)} disabled={i === batch.items.length - 1}>
                  ↓
                </button>
                <button onClick={() => setOpen({ ...open, [it.id]: !open[it.id] })}>{open[it.id] ? '▾' : '▸'}</button>
                <button className="danger small" onClick={() => editBatch((b) => b.items.splice(i, 1))}>
                  ✕
                </button>
              </div>
              {it.kind === 'patch' ? (
                <>
                  <div className="muted">{it.ops.length} op(s)</div>
                  {open[it.id] && (
                    <>
                      <ul className="ops">
                        {it.ops.map((op, k) => (
                          <li key={k}>
                            <code>{describeOp(op)}</code>
                            <button
                              className="small"
                              title="Quitar esta op"
                              onClick={() =>
                                editBatch((b) => {
                                  const p = b.items[i] as Extract<BatchItem, { kind: 'patch' }>;
                                  p.ops.splice(k, 1);
                                  if (!p.ops.length) b.items.splice(i, 1);
                                })
                              }
                            >
                              ✕
                            </button>
                          </li>
                        ))}
                      </ul>
                      <label className="field">
                        <span>Nota</span>
                        <textarea className="wide" rows={2} value={it.note ?? ''} onChange={(e) => editBatch((b) => ((b.items[i] as { note?: string }).note = e.target.value))} />
                      </label>
                    </>
                  )}
                </>
              ) : (
                <IntentBody it={it} i={i} expanded={!!open[it.id]} />
              )}
            </div>
          ))}
        </Section>
      </div>
      <aside className="side wide-side">
        <IntentForm />
        <Section title="Para Claude">
          <p className="muted">Guardá el lote y pegá esto en Claude Code (en la raíz del repo):</p>
          <div className="cmd">
            <code>{cmd}</code>
            <button onClick={() => navigator.clipboard.writeText(cmd).then(() => toast('Copiado'))}>Copiar</button>
          </div>
          {batchName === null && <p className="warn">Todavía no guardaste este lote.</p>}
        </Section>
        <Section title={`Lotes guardados (${list.length})`}>
          {list.map((b) => (
            <div key={b.name} className="row saved">
              <button
                className="link"
                onClick={() =>
                  api
                    .batch(packId, b.name)
                    .then((bt) => set({ batch: bt, batchName: b.name }))
                    .catch((e: Error) => toast(e.message, 'error'))
                }
              >
                {b.title}
              </button>
              <small className="muted">
                {b.pending}/{b.items} pend.
              </small>
              <button className="danger small" onClick={() => confirm(`¿Borrar el lote ${b.name}?`) && api.deleteBatch(packId, b.name).then(refresh)}>
                ✕
              </button>
            </div>
          ))}
        </Section>
      </aside>
    </div>
  );
}

function IntentBody({ it, i, expanded }: { it: Intent; i: number; expanded: boolean }) {
  const up = (fn: (x: Intent) => void) => editBatch((b) => fn(b.items[i] as Intent));
  if (!expanded)
    return (
      <div className="muted intent-text">
        {it.text} {it.targets?.length ? <code>{it.targets.join(' ')}</code> : null}
        {it.result && <div className="result">↳ {it.result}</div>}
      </div>
    );
  return (
    <div className="intent-edit">
      <textarea className="wide" rows={3} value={it.text} onChange={(e) => up((x) => (x.text = e.target.value))} />
      <label className="field">
        <span>Rutas (una por línea)</span>
        <textarea className="wide" rows={2} value={(it.targets ?? []).join('\n')} onChange={(e) => up((x) => (x.targets = lines(e.target.value)))} />
      </label>
      <label className="field">
        <span>Restricciones (una por línea)</span>
        <textarea className="wide" rows={2} value={(it.constraints ?? []).join('\n')} onChange={(e) => up((x) => (x.constraints = lines(e.target.value)))} />
      </label>
      <VerifyChecks value={it.verify ?? ['validate']} onChange={(v) => up((x) => (x.verify = v))} />
      {it.result && <div className="result">Resultado: {it.result}</div>}
    </div>
  );
}

const lines = (s: string) =>
  s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

function VerifyChecks({ value, onChange }: { value: Intent['verify']; onChange: (v: NonNullable<Intent['verify']>) => void }) {
  const v = value ?? [];
  return (
    <div className="row">
      <span className="muted">Verificar con:</span>
      {VERIFY.map((k) => (
        <label key={k} className="check inline">
          <input type="checkbox" checked={v.includes(k)} onChange={(e) => onChange(e.target.checked ? [...v, k] : v.filter((x) => x !== k))} /> {k}
        </label>
      ))}
    </div>
  );
}

function IntentForm() {
  const selFaction = useStore((s) => s.selFaction);
  const selNode = useStore((s) => s.selNode);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [targets, setTargets] = useState('');
  const [constraints, setConstraints] = useState('');
  const [verify, setVerify] = useState<NonNullable<Intent['verify']>>(['validate', 'sim']);
  const addTarget = (p: string) => setTargets((t) => (t.split('\n').includes(p) ? t : (t ? t + '\n' : '') + p));
  const add = () => {
    if (!text.trim()) return toast('Escribí qué querés que haga la IA', 'error');
    editBatch((b) =>
      b.items.push({
        id: itemId('intent'),
        kind: 'intent',
        title: title.trim() || text.trim().slice(0, 60),
        text: text.trim(),
        targets: lines(targets),
        constraints: lines(constraints),
        verify,
        status: 'pending',
      }),
    );
    setTitle('');
    setText('');
    setTargets('');
    setConstraints('');
    toast('Intención agregada al lote');
  };
  return (
    <Section title="Agregar intención para la IA">
      <label className="field">
        <span>Título</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bajar a Google" />
      </label>
      <label className="field">
        <span>Pedido (lenguaje natural)</span>
        <textarea className="wide" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Google gana 38%: bajala a ~25% sin tocar el mapa" />
      </label>
      <label className="field">
        <span>Rutas objetivo</span>
        <textarea className="wide" rows={2} value={targets} onChange={(e) => setTargets(e.target.value)} placeholder="/factions/google" />
      </label>
      <div className="row">
        {selFaction && <button onClick={() => addTarget(`/factions/${selFaction}`)}>＋ /factions/{selFaction}</button>}
        {selNode !== null && <button onClick={() => addTarget(`/map/nodes/${selNode}`)}>＋ /map/nodes/{selNode}</button>}
        <button onClick={() => addTarget('/map')}>＋ /map</button>
        <button onClick={() => addTarget('/rules')}>＋ /rules</button>
      </div>
      <label className="field">
        <span>Restricciones (una por línea)</span>
        <textarea className="wide" rows={2} value={constraints} onChange={(e) => setConstraints(e.target.value)} placeholder={'no tocar el mapa\nmáx. ±2 por número'} />
      </label>
      <VerifyChecks value={verify} onChange={setVerify} />
      <button className="primary" onClick={add}>
        ＋ Agregar al lote
      </button>
    </Section>
  );
}
