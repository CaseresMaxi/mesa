import { useMemo, useState } from 'react';
import { describeOp, diff, splitPack, SCHEMAS, type GamePackInput, type PackFileKey } from '@mesa/core';
import { z } from 'zod';
import { goToPath } from '../App.tsx';
import { edit, useStore } from '../state.ts';
import { JsonEditor, Section } from '../ui.tsx';

const FILES: PackFileKey[] = ['pack', 'rules', 'map', 'cards', 'factions', 'assets'];

export function JsonTab() {
  const draft = useStore((s) => s.draft!);
  const base = useStore((s) => s.base!);
  const [file, setFile] = useState<PackFileKey>('factions');
  const files = useMemo(() => splitPack(draft), [draft]);
  const ops = useMemo(() => diff(base, draft), [base, draft]);
  // el archivo de facciones va envuelto ({ factions: [...] }); el resto es 1:1
  const schema: z.ZodType = SCHEMAS[file];
  return (
    <div className="split">
      <div className="form">
        <div className="toolbar">
          {FILES.map((f) => (
            <button key={f} className={f === file ? 'on' : ''} onClick={() => setFile(f)}>
              {f}.json
            </button>
          ))}
          <span className="muted">Se confirma al instante si el JSON es válido para el esquema del archivo.</span>
        </div>
        <JsonEditor
          key={file}
          value={files[file]}
          schema={schema}
          rows={40}
          onCommit={(v) =>
            edit((d) => {
              const k = file as keyof GamePackInput;
              if (file === 'factions') d.factions = (v as { factions: GamePackInput['factions'] }).factions;
              else (d as Record<string, unknown>)[k] = v;
            })
          }
        />
      </div>
      <aside className="side wide-side">
        <Section title={`Diff contra disco (${ops.length})`}>
          {ops.length === 0 && <p className="muted">Sin cambios.</p>}
          <ul className="ops">
            {ops.map((op, i) => (
              <li key={i}>
                <button className="link" onClick={() => goToPath(op.path)}>
                  <code className={op.op}>{describeOp(op)}</code>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      </aside>
    </div>
  );
}
