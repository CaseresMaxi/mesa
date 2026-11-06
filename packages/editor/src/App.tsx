import { useEffect, useMemo, useState } from 'react';
import { validated } from './derived.ts';
import { diffToBatch, discardDraft, getState, loadPacks, openPack, redo, saveDraft, set, toast, undo, useStore, type Tab } from './state.ts';
import { diff, type Issue } from '@mesa/core';
import { MapTab } from './tabs/MapTab.tsx';
import { FactionsTab } from './tabs/FactionsTab.tsx';
import { CardsTab } from './tabs/CardsTab.tsx';
import { AssetsTab } from './tabs/AssetsTab.tsx';
import { AnimationsTab } from './tabs/AnimationsTab.tsx';
import { BalanceTab } from './tabs/BalanceTab.tsx';
import { BatchTab } from './tabs/BatchTab.tsx';
import { JsonTab } from './tabs/JsonTab.tsx';
import { isLive, playtest, stopPlaytest, syncDraft } from './playtest.ts';

const TABS: { id: Tab; label: string }[] = [
  { id: 'mapa', label: '🗺️ Mapa' },
  { id: 'facciones', label: '⚑ Facciones' },
  { id: 'cartas', label: '🃏 Cartas y reglas' },
  { id: 'assets', label: '🎨 Assets' },
  { id: 'animaciones', label: '🎬 Animaciones' },
  { id: 'balance', label: '⚖️ Balance' },
  { id: 'lote', label: '🤖 Lote IA' },
  { id: 'json', label: '{ } JSON' },
];

/** Lleva al usuario al lugar del pack donde está el problema. */
export function goToPath(path: string) {
  const seg = path.split('/').filter(Boolean);
  const s = getState();
  if (seg[0] === 'map') {
    set({ tab: 'mapa', selNode: seg[1] === 'nodes' && seg[2] !== undefined ? Number(seg[2]) : s.selNode });
  } else if (seg[0] === 'factions') {
    const fs = (s.draft?.factions ?? []) as { id: string }[];
    const f = fs.find((x) => x.id === seg[1]) ?? fs[Number(seg[1])];
    set({ tab: 'facciones', selFaction: f?.id ?? s.selFaction });
  } else if (seg[0] === 'assets') set({ tab: 'assets' });
  else if (seg[0] === 'animations') set({ tab: 'animaciones' });
  else set({ tab: 'cartas' });
}

export function App() {
  const [live, setLive] = useState(isLive());
  const draftNow = useStore((s) => s.draft);
  useEffect(() => syncDraft(), [draftNow]);
  const packs = useStore((s) => s.packs);
  const packId = useStore((s) => s.packId);
  const base = useStore((s) => s.base);
  const draft = useStore((s) => s.draft);
  const tab = useStore((s) => s.tab);
  const mode = useStore((s) => s.mode);
  const busy = useStore((s) => s.busy);
  const toastMsg = useStore((s) => s.toast);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const batchCount = useStore((s) => s.batch?.items.length ?? 0);
  const [showIssues, setShowIssues] = useState(false);

  useEffect(() => {
    loadPacks().catch((e: Error) => toast(`No pude listar packs: ${e.message}`, 'error'));
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') (e.preventDefault(), e.shiftKey ? redo() : undo());
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') (e.preventDefault(), redo());
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const u = new URL(location.href);
    u.searchParams.set('tab', tab);
    if (packId) u.searchParams.set('pack', packId);
    history.replaceState(null, '', u);
  }, [tab, packId]);

  const { issues } = validated(draft);
  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.length - errors;
  const dirty = useMemo(() => (base && draft ? diff(base, draft).length : 0), [base, draft]);

  const onSave = () => {
    if (mode === 'lote') {
      const n = diffToBatch(true);
      toast(n ? `${n} item(s) agregados al lote` : 'No hay cambios para enviar');
      if (n) set({ tab: 'lote' });
    } else void saveDraft();
  };

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <b>Mesa</b> <span>editor de packs</span>
        </div>
        <select value={packId ?? ''} onChange={(e) => (!dirty || confirm('Hay cambios sin guardar. ¿Cambiar de pack igual?')) && openPack(e.target.value)}>
          {packs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button className={`status ${errors ? 'bad' : warnings ? 'warn' : 'good'}`} onClick={() => setShowIssues(!showIssues)} title="Ver problemas de validación">
          {errors ? `✗ ${errors} error(es)` : '✓ válido'}
          {warnings ? ` · ⚠ ${warnings}` : ''}
        </button>
        <span className="dirty">{dirty ? `${dirty} cambio(s) sin guardar` : 'sin cambios'}</span>
        <span className="spacer" />
        <button onClick={undo} disabled={!canUndo} title="Deshacer (Ctrl+Z)">
          ↶
        </button>
        <button onClick={redo} disabled={!canRedo} title="Rehacer (Ctrl+Shift+Z)">
          ↷
        </button>
        <div className="mode" title="Directo: guardás en disco. Lote: los cambios se juntan en un lote para revisar o para que la IA los procese.">
          <button className={mode === 'directo' ? 'on' : ''} onClick={() => set({ mode: 'directo' })}>
            Directo
          </button>
          <button className={mode === 'lote' ? 'on' : ''} onClick={() => set({ mode: 'lote' })}>
            Lote {batchCount ? `(${batchCount})` : ''}
          </button>
        </div>
        <button onClick={() => void playtest().then(() => setLive(true))} title="Jugar el borrador en el cliente web (se actualiza en vivo)">
          ▶ Probar{live ? ' (en vivo)' : ''}
        </button>
        {live && (
          <button onClick={() => void stopPlaytest().then(() => setLive(false))} title="Dejar de sincronizar y borrar el borrador publicado">
            ■
          </button>
        )}
        <button onClick={() => dirty && confirm('¿Descartar todos los cambios del borrador?') && discardDraft()} disabled={!dirty}>
          Descartar
        </button>
        <button className="primary" onClick={onSave} disabled={!dirty || busy}>
          {mode === 'lote' ? 'Enviar al lote' : 'Guardar en disco'}
        </button>
      </header>
      {showIssues && (
        <div className="issues">
          {issues.length === 0 && <div>Sin problemas 🎉</div>}
          {issues.map((i: Issue, k) => (
            <button key={k} className={`issue ${i.level}`} onClick={() => (goToPath(i.path), setShowIssues(false))}>
              <span>{i.level === 'error' ? '✗' : '⚠'}</span> <code>{i.path}</code> {i.message}
            </button>
          ))}
        </div>
      )}
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => set({ tab: t.id })}>
            {t.label}
          </button>
        ))}
      </nav>
      <main className="content">
        {!draft ? (
          <div className="empty">{busy ? 'Cargando…' : 'No hay packs en /packs.'}</div>
        ) : (
          <>
            {tab === 'mapa' && <MapTab />}
            {tab === 'facciones' && <FactionsTab />}
            {tab === 'cartas' && <CardsTab />}
            {tab === 'assets' && <AssetsTab />}
            {tab === 'animaciones' && <AnimationsTab />}
            {tab === 'balance' && <BalanceTab />}
            {tab === 'lote' && <BatchTab />}
            {tab === 'json' && <JsonTab />}
          </>
        )}
      </main>
      {toastMsg && <div className={`toast ${toastMsg.kind}`}>{toastMsg.text}</div>}
    </div>
  );
}
