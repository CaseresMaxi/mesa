import { useEffect, useMemo, useState } from 'react';
import { collectAssets, RECIPES, renderAsset, type ResolvedAsset } from '@mesa/art';
import { AssetEntry, Assets, type GamePack } from '@mesa/core';
import { api, download } from '../api.ts';
import { loadArtFonts } from '../fonts.ts';
import { validated } from '../derived.ts';
import { edit, useStore } from '../state.ts';
import { JsonEditor, Section } from '../ui.tsx';

const svgUrl = (svg: string) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

/** Renderiza los SVG de a poco (rough.js no es gratis) para no congelar la UI. */
function useRendered(pack: GamePack | null, assets: ResolvedAsset[]) {
  const [svgs, setSvgs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!pack) return;
    let cancelled = false;
    let started = false;
    let i = 0;
    const out: Record<string, string> = {};
    const tick = () => {
      if (cancelled) return;
      const t0 = performance.now();
      while (i < assets.length && performance.now() - t0 < 30) {
        const a = assets[i++];
        try {
          out[a.id] = renderAsset(pack, a);
        } catch (e) {
          out[a.id] = `error:${(e as Error).message}`;
        }
      }
      setSvgs({ ...out });
      if (i < assets.length) setTimeout(tick, 0);
    };
    void loadArtFonts().then(() => {
      if (!started) (started = true), tick();
    });
    return () => {
      cancelled = true;
    };
  }, [pack, assets]);
  return svgs;
}

export function AssetsTab() {
  const draft = useStore((s) => s.draft!);
  const packId = useStore((s) => s.packId!);
  const { pack } = validated(draft);
  const assets = useMemo(() => (pack ? collectAssets(pack) : []), [pack]);
  const svgs = useRendered(pack, assets);
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  if (!pack) return <div className="empty">El pack tiene errores de validación: corregilos para ver los assets.</div>;

  const shown = assets.filter((a) => !filter || `${a.id} ${a.name} ${a.category} ${a.recipe}`.toLowerCase().includes(filter.toLowerCase()));
  const cats = [...new Set(shown.map((a) => a.category))];
  const selected = assets.find((a) => a.id === sel);
  const src = (a: ResolvedAsset) => (a.file ? api.fileUrl(packId, a.file) : svgs[a.id] && !svgs[a.id].startsWith('error:') ? svgUrl(svgs[a.id]) : undefined);

  return (
    <div className="split">
      <div className="gallery">
        <div className="toolbar">
          <input placeholder="Filtrar…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <span className="muted">
            {assets.length} assets ({assets.filter((a) => a.manual).length} del manifest) · auto: {String(pack.assets.auto)}
          </span>
          <button
            onClick={() => {
              const id = prompt('Id del nuevo asset', 'mi-asset');
              if (!id) return;
              edit((d) => {
                d.assets.entries = [...(d.assets.entries ?? []), { id, category: 'Custom', recipe: Object.keys(RECIPES)[0] ?? 'card', params: {} }];
              });
              setSel(id);
            }}
          >
            ＋ Agregar entrada
          </button>
        </div>
        {cats.map((c) => (
          <Section key={c} title={`${c} (${shown.filter((a) => a.category === c).length})`}>
            <div className="thumbs">
              {shown
                .filter((a) => a.category === c)
                .map((a) => (
                  <button key={a.id} className={`thumb ${sel === a.id ? 'on' : ''} ${a.manual ? 'manual' : ''}`} onClick={() => setSel(a.id)} title={`${a.id} · ${a.recipe}`}>
                    {src(a) ? <img src={src(a)} alt={a.name} loading="lazy" /> : <span className="ph">{svgs[a.id]?.startsWith('error:') ? '⚠' : '…'}</span>}
                    <span>{a.name}</span>
                  </button>
                ))}
            </div>
          </Section>
        ))}
      </div>
      <aside className="side wide-side">{selected ? <AssetDetail a={selected} svg={svgs[selected.id]} src={src(selected)} /> : <RecipesHelp />}</aside>
    </div>
  );
}

function AssetDetail({ a, svg, src }: { a: ResolvedAsset; svg?: string; src?: string }) {
  const entries = useStore((s) => s.draft!.assets.entries ?? []);
  const idx = entries.findIndex((e) => e.id === a.id);
  return (
    <Section title={a.name}>
      <div className="preview-big">{src ? <img src={src} alt={a.name} /> : <pre className="json-err">{svg?.replace('error:', '') ?? 'renderizando…'}</pre>}</div>
      <p className="muted">
        <code>{a.id}</code> · receta <code>{a.recipe}</code> · {a.w}×{a.h} · {a.manual ? 'manifest' : 'automático'}
        {a.file && (
          <>
            {' '}
            · archivo <code>{a.file}</code>
          </>
        )}
      </p>
      {RECIPES[a.recipe] && <p className="muted">{RECIPES[a.recipe].description}</p>}
      <div className="row">
        <button disabled={!svg || svg.startsWith('error:')} onClick={() => svg && download(`${a.id}.svg`, svg, 'image/svg+xml')}>
          ⬇ SVG
        </button>
      </div>
      {idx >= 0 ? (
        <>
          <h4>Entrada del manifest</h4>
          <JsonEditor value={entries[idx]} schema={AssetEntry} rows={10} onCommit={(v) => edit((d) => (d.assets.entries![idx] = v))} />
          <button className="danger" onClick={() => edit((d) => d.assets.entries!.splice(idx, 1))}>
            Quitar del manifest
          </button>
        </>
      ) : (
        <>
          <h4>Parámetros (automático)</h4>
          <pre className="code">{JSON.stringify(a.params, null, 2)}</pre>
          <button
            onClick={() =>
              edit((d) => {
                d.assets.entries = [...(d.assets.entries ?? []), { id: a.id, category: a.category, recipe: a.recipe, params: a.params }];
              })
            }
            title="Copia la entrada al manifest para pisar parámetros o apuntarla a un archivo propio"
          >
            Personalizar (copiar al manifest)
          </button>
        </>
      )}
    </Section>
  );
}

function RecipesHelp() {
  const style = useStore((s) => s.draft!.assets.style);
  return (
    <>
      <Section title="Estilo">
        <JsonEditor value={style ?? {}} schema={Assets.shape.style} rows={5} onCommit={(v) => edit((d) => (d.assets.style = v as typeof d.assets.style))} />
      </Section>
      <Section title="Recetas">
        <ul className="recipes">
          {Object.entries(RECIPES).map(([k, r]) => (
            <li key={k}>
              <code>{k}</code> <small>{r.params}</small>
              <div className="muted">{r.description}</div>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
