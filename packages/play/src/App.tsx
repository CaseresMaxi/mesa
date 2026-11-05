import { useEffect, useState } from 'react';
import { invalidateAssets } from './assets.ts';
import { loadArtFonts } from './fonts.ts';
import { DEV, listPacks, loadPack, onPackChange } from './packSource.ts';
import { useSession } from './session.ts';
import { Game } from './ui/Game.tsx';
import { Lobby, Menu } from './ui/Lobby.tsx';

const params = new URLSearchParams(location.search);

export function App() {
  const { screen, setPack, toast, packId, usingDraft, role, devOpen, set } = useSession();
  const [packs, setPacks] = useState<{ id: string; name: string }[]>([]);
  const [draftAvailable, setDraftAvailable] = useState(false);
  const [ready, setReady] = useState(false);

  const open = async (id: string, draft: boolean, replay = true) => {
    const r = await loadPack(id, draft);
    invalidateAssets();
    setPack(r.input, { draft: r.draft, replay });
    if (DEV) {
      setDraftAvailable((await (await fetch(`/api/packs/${id}/draft`)).json()).exists);
      const url = new URL(location.href);
      url.searchParams.set('pack', id);
      if (r.draft) url.searchParams.set('draft', '1');
      else url.searchParams.delete('draft');
      history.replaceState(null, '', url);
    }
  };

  useEffect(() => {
    (async () => {
      await loadArtFonts();
      const list = await listPacks();
      setPacks(list);
      const id = params.get('pack') ?? list[0]?.id;
      if (id) await open(id, params.get('draft') === '1');
      setReady(true);
      if (params.get('room')) useSession.getState().joinRoom(params.get('room')!);
      else if (params.has('auto')) {
        // ?auto → arranca directo una partida local (útil para probar con herramientas automáticas)
        const st = useSession.getState();
        st.startLocal();
        if (params.get('auto') === 'bots') st.setSeats(st.seats.map((s) => ({ ...s, kind: 'bot' })));
        useSession.getState().startGame();
      }
    })().catch((e: Error) => useSession.getState().toast_(e.message));
  }, []);

  // hot-reload: cambia el pack en disco (o el borrador del editor) → recargar y re-jugar el historial
  useEffect(
    () =>
      onPackChange((e) => {
        if (e.pack !== packId || role === 'peer') return;
        if (e.draft) setDraftAvailable(true);
        if (e.draft !== usingDraft) return; // sólo recargar la fuente que se está jugando
        open(e.pack, usingDraft).catch((err: Error) => useSession.getState().toast_(err.message));
      }),
    [packId, usingDraft, role],
  );

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === '`' && !(e.target instanceof HTMLInputElement)) set({ devOpen: !devOpen });
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [devOpen]);

  if (!ready) return <div className="menu">Cargando…</div>;
  return (
    <>
      {screen === 'menu' && <Menu packs={packs} draftAvailable={draftAvailable} onPack={(id, d) => open(id, d, false)} />}
      {screen === 'lobby' && <Lobby />}
      {screen === 'game' && <Game />}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
