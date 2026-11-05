import { useEffect, useState, type ReactNode } from 'react';
import type { z } from 'zod';

/** Controles de formulario chicos y reutilizables. */

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field" title={hint}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Num({ label, value, onChange, min, max, step, hint }: { label: string; value: number | undefined; onChange: (v: number) => void; min?: number; max?: number; step?: number; hint?: string }) {
  const [txt, setTxt] = useState(value === undefined ? '' : String(value));
  useEffect(() => setTxt(value === undefined ? '' : String(value)), [value]);
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        value={txt}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => {
          setTxt(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(n)) onChange(n);
        }}
      />
    </Field>
  );
}

export function Text({ label, value, onChange, hint, wide, area }: { label: string; value: string | undefined; onChange: (v: string) => void; hint?: string; wide?: boolean; area?: boolean }) {
  return (
    <Field label={label} hint={hint}>
      {area ? (
        <textarea className={wide ? 'wide' : ''} value={value ?? ''} rows={3} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={wide ? 'wide' : ''} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}

export function Check({ label, value, onChange, hint }: { label: string; value: boolean | undefined; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="check" title={hint}>
      <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function ColorIn({ label, value, onChange }: { label: string; value: string | undefined; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <span className="color-in">
        <input type="color" value={value ?? '#000000'} onChange={(e) => onChange(e.target.value)} />
        <input value={value ?? ''} onChange={(e) => onChange(e.target.value)} size={8} />
      </span>
    </Field>
  );
}

export function Section({ title, children, right, open = true }: { title: string; children: ReactNode; right?: ReactNode; open?: boolean }) {
  return (
    <details className="section" open={open}>
      <summary>
        <span>{title}</span>
        {right}
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

/**
 * Editor JSON con validación zod en vivo: sólo confirma (onCommit) cuando el JSON
 * parsea y cumple el esquema. Así el borrador nunca queda con formas inválidas.
 */
export function JsonEditor<T>({ value, schema, onCommit, rows = 8, nullable }: { value: T; schema: z.ZodType; onCommit: (v: T) => void; rows?: number; nullable?: boolean }) {
  const serialized = JSON.stringify(value ?? null, null, 2);
  const [txt, setTxt] = useState(serialized);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setTxt(serialized);
    setErr(null);
  }, [serialized]);
  const tryCommit = (t: string) => {
    setTxt(t);
    let data: unknown;
    try {
      data = JSON.parse(t);
    } catch (e) {
      return setErr(`JSON inválido: ${(e as Error).message}`);
    }
    if (data === null && nullable) {
      setErr(null);
      return onCommit(null as T);
    }
    const r = schema.safeParse(data);
    if (!r.success) return setErr(r.error.issues.map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`).join('\n'));
    setErr(null);
    onCommit(data as T);
  };
  return (
    <div className="json-editor">
      <textarea spellCheck={false} rows={rows} value={txt} onChange={(e) => tryCommit(e.target.value)} className={err ? 'bad' : ''} />
      {err && <pre className="json-err">{err}</pre>}
    </div>
  );
}

export function Bar({ value, max = 1, color, label }: { value: number; max?: number; color?: string; label?: string }) {
  return (
    <span className="bar" title={label}>
      <span style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, background: color }} />
    </span>
  );
}

export function useLocal<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : init;
  });
  return [v, (x: T) => (setV(x), localStorage.setItem(key, JSON.stringify(x)))];
}

/** Input de texto que confirma al salir del campo o con Enter (para ids y listas). */
export function BlurText({ label, value, onCommit, hint }: { label: string; value: string; onCommit: (v: string) => boolean | void; hint?: string }) {
  const [txt, setTxt] = useState(value);
  useEffect(() => setTxt(value), [value]);
  const commit = () => {
    if (txt === value) return;
    if (onCommit(txt) === false) setTxt(value);
  };
  return (
    <Field label={label} hint={hint}>
      <input value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
    </Field>
  );
}

export function ListNum({ label, value, onChange }: { label: string; value: number[]; onChange: (v: number[]) => void }) {
  return (
    <BlurText
      label={label}
      value={value.join(', ')}
      onCommit={(v) => {
        const nums = v.split(',').map((s) => s.trim()).filter(Boolean).map(Number);
        if (!nums.length || !nums.every((n) => Number.isInteger(n) && n >= 0)) return false;
        onChange(nums);
      }}
    />
  );
}

export function ListText({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <BlurText
      label={label}
      value={value.join(', ')}
      onCommit={(v) => {
        const xs = v.split(',').map((s) => s.trim()).filter(Boolean);
        if (!xs.length) return false;
        onChange(xs);
      }}
    />
  );
}
