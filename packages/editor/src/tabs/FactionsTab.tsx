import { z } from 'zod';
import { Faction, Requirement } from '@mesa/core';
import { edit, set, useStore } from '../state.ts';
import { BlurText, Check, ColorIn, JsonEditor, ListNum, Num, Section, Text } from '../ui.tsx';
import type { FactionInput } from '../derived.ts';

const Reqs = z.array(Requirement);

export function FactionsTab() {
  const factions = useStore((s) => s.draft!.factions);
  const selId = useStore((s) => s.selFaction);
  const f = factions.find((x) => x.id === selId) ?? factions[0];

  return (
    <div className="split faction-split">
      <aside className="list">
        {factions.map((x) => (
          <button key={x.id} className={x.id === f?.id ? 'on' : ''} onClick={() => set({ selFaction: x.id })}>
            <i className="dot" style={{ background: x.color }} /> {x.name}
            <small>{x.archetype === 'nomad' ? 'nómade' : ''}</small>
          </button>
        ))}
        <button
          className="add"
          onClick={() =>
            edit((d) => {
              const id = uniqueId(d.factions, 'nueva');
              d.factions.push({ id, name: 'Nueva facción', short: 'Nueva', color: '#888888', warriors: { count: 10, name: 'guerreros', singular: 'guerrero' }, setup: [{ at: 'corner', warriors: 3 }] });
              set({ selFaction: id });
            })
          }
        >
          ＋ Facción
        </button>
      </aside>
      {f ? <FactionForm key={f.id} f={f} /> : <div className="empty">Sin facciones</div>}
    </div>
  );
}

function uniqueId(list: { id: string }[], base: string) {
  let id = base;
  for (let i = 2; list.some((x) => x.id === id); i++) id = `${base}-${i}`;
  return id;
}

function FactionForm({ f }: { f: FactionInput }) {
  const id = f.id;
  const up = (fn: (x: FactionInput) => void) => edit((d) => fn(d.factions.find((x) => x.id === id)!));
  const battle = f.battle ?? {};
  const move = f.move ?? {};
  return (
    <div className="form">
      <div className="form-head" style={{ borderColor: f.color }}>
        <h2>
          <i className="dot big" style={{ background: f.color }} /> {f.name}
        </h2>
        <span className="muted">/factions/{f.id}</span>
        <span className="spacer" />
        <button
          onClick={() =>
            edit((d) => {
              const copy = structuredClone(d.factions.find((x) => x.id === id)!);
              copy.id = uniqueId(d.factions, `${id}-copia`);
              copy.name += ' (copia)';
              d.factions.push(copy);
              set({ selFaction: copy.id });
            })
          }
        >
          Duplicar
        </button>
        <button className="danger" onClick={() => confirm(`¿Borrar la facción ${f.name}?`) && (edit((d) => (d.factions = d.factions.filter((x) => x.id !== id))), set({ selFaction: null }))}>
          Borrar
        </button>
      </div>

      <Section title="Identidad">
        <div className="grid">
          <BlurText
            label="id"
            value={f.id}
            hint="Cambiarlo rompe lotes y reportes que lo referencian"
            onCommit={(v) => {
              if (!/^[a-z0-9][a-z0-9_-]*$/.test(v)) return false;
              up((x) => (x.id = v));
              set({ selFaction: v });
            }}
          />
          <Text label="Nombre" value={f.name} onChange={(v) => up((x) => (x.name = v))} />
          <Text label="Corto" value={f.short} onChange={(v) => up((x) => (x.short = v))} />
          <ColorIn label="Color" value={f.color} onChange={(v) => up((x) => (x.color = v))} />
          <label className="field">
            <span>Arquetipo</span>
            <select value={f.archetype ?? 'standard'} onChange={(e) => up((x) => (x.archetype = e.target.value as 'standard' | 'nomad'))}>
              <option value="standard">estándar</option>
              <option value="nomad">nómade</option>
            </select>
          </label>
        </div>
        <Text label="Tagline" wide value={f.tagline} onChange={(v) => up((x) => (x.tagline = v))} />
      </Section>

      <Section title="Guerreros y acciones">
        <div className="grid">
          <Num label="Cantidad" value={f.warriors.count} min={1} onChange={(v) => up((x) => (x.warriors.count = v))} />
          <Text label="Nombre (plural)" value={f.warriors.name} onChange={(v) => up((x) => (x.warriors.name = v))} />
          <Text label="Singular" value={f.warriors.singular} onChange={(v) => up((x) => (x.warriors.singular = v))} />
          <Num label="Acciones por turno" value={f.actions ?? 3} min={0} onChange={(v) => up((x) => (x.actions = v))} />
          <Num label="Rango de movimiento" value={move.range ?? 1} min={1} onChange={(v) => up((x) => (x.move = { ...x.move, range: v }))} />
          <Check label="Mover exige gobernar origen o destino" value={move.needsRule ?? true} onChange={(v) => up((x) => (x.move = { ...x.move, needsRule: v }))} />
          <Check label="Cualquier carta paga en cualquier nodo" value={f.anyCard} onChange={(v) => up((x) => (x.anyCard = v))} />
        </div>
      </Section>

      <Section title="Batalla">
        <div className="grid">
          <Num label="Máx. dados" value={battle.maxDice ?? 3} min={0} max={6} onChange={(v) => up((x) => (x.battle = { ...x.battle, maxDice: v }))} />
          <Num label="Bonus al defender" value={battle.defenseBonus ?? 0} min={0} onChange={(v) => up((x) => (x.battle = { ...x.battle, defenseBonus: v }))} />
          <Num label="PV por guerrero eliminado" value={battle.vpPerWarriorKill ?? 0} min={0} onChange={(v) => up((x) => (x.battle = { ...x.battle, vpPerWarriorKill: v }))} />
          <Check label="1 batalla gratis por turno" value={battle.free} onChange={(v) => up((x) => (x.battle = { ...x.battle, free: v }))} />
        </div>
      </Section>

      <Section title="Reclutar" right={<NullToggle on={!!f.recruit} onChange={(v) => up((x) => (x.recruit = v ? { amount: 1, requires: [] } : null))} />}>
        {f.recruit ? (
          <>
            <Num label="Guerreros por reclutamiento" value={f.recruit.amount} min={1} onChange={(v) => up((x) => (x.recruit!.amount = v))} />
            <h4>Requisitos (Requirement[])</h4>
            <JsonEditor value={f.recruit.requires ?? []} schema={Reqs} rows={5} onCommit={(v) => up((x) => (x.recruit!.requires = v))} />
          </>
        ) : (
          <p className="muted">No recluta.</p>
        )}
      </Section>

      <Section title="Edificio" right={<NullToggle on={!!f.building} onChange={(v) => up((x) => (x.building = v ? { kind: 'edificio', name: 'Edificio', count: 3, vp: [1, 2, 2] } : null))} />}>
        {f.building ? (
          <div className="grid">
            <Text label="kind" value={f.building.kind} onChange={(v) => up((x) => (x.building!.kind = v))} />
            <Text label="Nombre" value={f.building.name} onChange={(v) => up((x) => (x.building!.name = v))} />
            <Num label="Cantidad" value={f.building.count} min={1} onChange={(v) => up((x) => (x.building!.count = v))} />
            <ListNum label="Pista de PV (coma)" value={f.building.vp} onChange={(v) => up((x) => (x.building!.vp = v))} />
          </div>
        ) : (
          <p className="muted">Sin edificios.</p>
        )}
      </Section>

      <Section title="Ficha" right={<NullToggle on={!!f.token} onChange={(v) => up((x) => (x.token = v ? { kind: 'ficha', name: 'Ficha', count: 5, requires: [] } : null))} />}>
        {f.token ? (
          <>
            <div className="grid">
              <Text label="kind" value={f.token.kind} onChange={(v) => up((x) => (x.token!.kind = v))} />
              <Text label="Nombre" value={f.token.name} onChange={(v) => up((x) => (x.token!.name = v))} />
              <Num label="Cantidad" value={f.token.count} min={1} onChange={(v) => up((x) => (x.token!.count = v))} />
            </div>
            <h4>Dónde se puede colocar (Requirement[])</h4>
            <JsonEditor value={f.token.requires ?? []} schema={Reqs} rows={6} onCommit={(v) => up((x) => (x.token!.requires = v))} />
          </>
        ) : (
          <p className="muted">Sin fichas.</p>
        )}
      </Section>

      <Section title="Habilidad especial (DSL)">
        <p className="muted">
          <code>{'{ name, hint, requires: [{cond, error}], effects: [{do: ...}] }'}</code> o <code>null</code>. Ver docs/DSL.md.
        </p>
        <JsonEditor value={f.special ?? null} nullable schema={Faction.shape.special} rows={10} onCommit={(v) => up((x) => (x.special = v))} />
      </Section>

      <Section title="Setup inicial">
        <JsonEditor value={f.setup ?? []} schema={Faction.shape.setup} rows={6} onCommit={(v) => up((x) => (x.setup = v))} />
      </Section>

      <Section title="Al empezar el turno (Effect[])">
        <JsonEditor value={f.onTurnStart ?? []} schema={Faction.shape.onTurnStart} rows={6} onCommit={(v) => up((x) => (x.onTurnStart = v))} />
      </Section>

      <Section title="Puntuación de cierre (ScoreRule[])">
        <JsonEditor value={f.onClose ?? []} schema={Faction.shape.onClose} rows={12} onCommit={(v) => up((x) => (x.onClose = v))} />
      </Section>

      {(f.archetype === 'nomad' || f.nomad) && (
        <Section title="Nómade">
          <JsonEditor value={f.nomad ?? null} nullable schema={Faction.shape.nomad} rows={14} onCommit={(v) => up((x) => (v === null ? delete x.nomad : (x.nomad = v)))} />
        </Section>
      )}

      <Section title="Resumen (una línea por regla)">
        <textarea className="wide" rows={6} value={(f.summary ?? []).join('\n')} onChange={(e) => up((x) => (x.summary = e.target.value.split('\n')))} />
      </Section>
    </div>
  );
}

function NullToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check inline" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} /> activo
    </label>
  );
}
