import {
  createEngine,
  greedyBot,
  lcg,
  validatePack,
  type Engine,
  type GamePack,
  type GamePackInput,
  type GameState,
  type GameView,
  type Issue,
  type Move,
} from '@mesa/core';
import { joinRoom, type Room } from 'trystero';
import { create } from 'zustand';

/**
 * Sesión de juego: una "autoridad" (local o host) corre el motor y es la única que muta el estado;
 * los peers sólo reciben su vista filtrada. Todo se guarda como (semilla, asientos, historial de moves),
 * así que una partida se puede re-jugar exacta sobre otra versión del pack (hot-reload) o desde un save.
 */

export type SeatKind = 'human' | 'bot';
export interface Seat {
  faction: string;
  name: string;
  kind: SeatKind;
  /** playerId del dueño (online). */
  ownerId: string | null;
  connected: boolean;
}
export interface HistoryEntry {
  seat: number;
  move: Move;
}
export interface SaveFile {
  format: 'mesa-save';
  version: 1;
  pack: string;
  packHash: string;
  savedAt: string;
  seed: number;
  seats: Seat[];
  history: HistoryEntry[];
}

type Screen = 'menu' | 'lobby' | 'game';
type Role = 'local' | 'host' | 'peer';

type ToHost = { t: 'hello'; name: string; playerId: string } | { t: 'claim'; seat: number } | { t: 'intent'; move: Move } | { t: 'undo' };
type ToPeer =
  | { t: 'pack'; input: GamePackInput; hash: string }
  | { t: 'lobby'; seats: Seat[]; started: boolean; room: string }
  | { t: 'state'; view: GameView; seat: number | null; canUndo: boolean; seq: number }
  | { t: 'reject'; error: string };

export function hashPack(input: unknown): string {
  const s = JSON.stringify(input);
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619) >>> 0;
  return x.toString(16);
}

function playerId(): string {
  let id = localStorage.getItem('mesa.playerId');
  if (!id) localStorage.setItem('mesa.playerId', (id = crypto.randomUUID()));
  return id;
}

export function genRoomCode(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint32Array(5)), (n) => abc[n % abc.length]).join('');
}

// ───────────────────────── autoridad ─────────────────────────

class Authority {
  state: GameState | null = null;
  history: HistoryEntry[] = [];
  /** Índices de history en que se puede volver (moves deshacibles dentro del turno). */
  undoMarks: number[] = [];
  seq = 0;
  engine: Engine;
  input: GamePackInput;
  seats: Seat[];
  seed: number;
  room: string;

  constructor(engine: Engine, input: GamePackInput, seats: Seat[], seed: number, room: string) {
    this.engine = engine;
    this.input = input;
    this.seats = seats;
    this.seed = seed;
    this.room = room;
  }

  start() {
    this.state = this.engine.createGame({ seed: this.seed, players: this.seats.map((s, i) => ({ faction: s.faction, name: s.name || `Jugador ${i + 1}` })) });
    this.history = [];
    this.undoMarks = [];
    this.seq++;
  }

  apply(seat: number, move: Move): string | null {
    if (!this.state) return 'La partida no empezó';
    const prev = this.state;
    const r = this.engine.applyMove(prev, seat, move);
    if (!r.ok) return r.error;
    const sameTurn = r.state.turn === prev.turn && r.state.phase === 'dia';
    if (this.engine.isUndoable(move) && sameTurn) this.undoMarks.push(this.history.length);
    else this.undoMarks = [];
    this.history.push({ seat, move });
    this.state = r.state;
    this.seq++;
    return null;
  }

  currentSeat(): number | null {
    const s = this.state;
    return s ? s.factions[s.order[s.current]].seat : null;
  }

  canUndo(seat: number | null): boolean {
    return !!this.state && seat !== null && this.undoMarks.length > 0 && this.currentSeat() === seat;
  }

  undo(): string | null {
    const mark = this.undoMarks.pop();
    if (mark === undefined) return 'No se puede deshacer';
    const r = replay(this.engine, this.seed, this.seats, this.history.slice(0, mark));
    this.state = r.state;
    this.history = this.history.slice(0, mark);
    this.seq++;
    return null;
  }

  /** Cambia el pack y re-juega el historial. Devuelve hasta dónde llegó. */
  reload(engine: Engine, input: GamePackInput): { applied: number; error: string | null } {
    this.engine = engine;
    this.input = input;
    if (!this.state) return { applied: 0, error: null };
    const r = replay(engine, this.seed, this.seats, this.history);
    this.state = r.state;
    this.history = this.history.slice(0, r.applied);
    this.undoMarks = [];
    this.seq++;
    return { applied: r.applied, error: r.error };
  }

  save(): SaveFile {
    return {
      format: 'mesa-save',
      version: 1,
      pack: this.engine.pack.pack.id,
      packHash: hashPack(this.input),
      savedAt: new Date().toISOString(),
      seed: this.seed,
      seats: this.seats.map((s) => ({ ...s, connected: false })),
      history: this.history,
    };
  }
}

export function replay(engine: Engine, seed: number, seats: Seat[], history: HistoryEntry[]): { state: GameState; applied: number; error: string | null } {
  let state = engine.createGame({ seed, players: seats.map((s, i) => ({ faction: s.faction, name: s.name || `Jugador ${i + 1}` })) });
  for (let i = 0; i < history.length; i++) {
    const r = engine.applyMove(state, history[i].seat, history[i].move);
    if (!r.ok) return { state, applied: i, error: `move #${i + 1} (${history[i].move.type}): ${r.error}` };
    state = r.state;
  }
  return { state, applied: history.length, error: null };
}

// ───────────────────────── store ─────────────────────────

interface Store {
  screen: Screen;
  role: Role | null;
  name: string;
  playerId: string;
  packId: string | null;
  input: GamePackInput | null;
  pack: GamePack | null;
  engine: Engine | null;
  issues: Issue[];
  usingDraft: boolean;
  seats: Seat[];
  seed: number;
  room: string | null;
  view: GameView | null;
  /** Estado completo (sólo autoridad): para el panel de desarrollo. */
  full: GameState | null;
  history: HistoryEntry[];
  mySeat: number | null;
  canUndo: boolean;
  peers: number;
  toast: string | null;
  /** Dev: ver todas las manos y el mazo. */
  godView: boolean;
  botDelay: number;
  botsPaused: boolean;
  devOpen: boolean;

  setPack(input: GamePackInput, opts?: { draft?: boolean; replay?: boolean }): void;
  setName(n: string): void;
  toast_(msg: string): void;
  setSeats(seats: Seat[]): void;
  setSeed(seed: number): void;
  set(p: Partial<Store>): void;
  startLocal(): void;
  createRoom(): void;
  joinRoom(code: string): void;
  claimSeat(i: number): void;
  startGame(): void;
  send(m: Move): void;
  undo(): void;
  restart(): void;
  stepBot(): void;
  exportSave(): SaveFile | null;
  loadSave(save: SaveFile): void;
  leave(): void;
}

let authority: Authority | null = null;
let room: Room | null = null;
let sendMsg: ((msg: ToHost | ToPeer, target?: string) => void) | null = null;
const peerPlayers = new Map<string, string>();
let hostPeerId: string | null = null;
let lastSeq = -1;
let botTimer: ReturnType<typeof setTimeout> | null = null;

function defaultSeats(pack: GamePack, n = Math.min(4, pack.pack.players.max, pack.map.startCorners.length)): Seat[] {
  return pack.factions.slice(0, n).map((f, i) => ({ faction: f.id, name: i === 0 ? '' : `Bot ${i}`, kind: i === 0 ? 'human' : 'bot', ownerId: null, connected: false }));
}

function openRoom(code: string, packId: string, onMsg: (msg: ToHost | ToPeer, peerId: string) => void) {
  room?.leave();
  room = joinRoom({ appId: `mesa-${packId}`, password: `mesa:${packId}:${code}` }, code);
  const action = room.makeAction<string>('msg');
  sendMsg = (msg, target) => void action.send(JSON.stringify(msg), target ? { target } : undefined);
  action.onMessage = (data, ctx) => {
    try {
      onMsg(JSON.parse(data), ctx.peerId);
    } catch (e) {
      console.warn('Mensaje inválido', e);
    }
  };
  return room;
}

/** Asiento desde el que mira esta pantalla. */
function viewerSeat(a: Authority, role: Role, pid: string): number | null {
  if (role === 'host') {
    const i = a.seats.findIndex((s) => s.ownerId === pid);
    return i < 0 ? null : i;
  }
  // local: el asiento humano que juega ahora (o el último humano)
  const cur = a.currentSeat();
  if (cur !== null && a.seats[cur].kind === 'human') return cur;
  const firstHuman = a.seats.findIndex((s) => s.kind === 'human');
  return firstHuman < 0 ? null : firstHuman;
}

function sync() {
  const a = authority;
  const st = useSession.getState();
  if (!a || !st.role || st.role === 'peer') return;
  const seat = viewerSeat(a, st.role, st.playerId);
  useSession.setState({
    seats: structuredClone(a.seats),
    view: a.state ? (st.godView ? godView(a.state, seat) : a.engine.playerView(a.state, seat)) : null,
    full: a.state,
    history: a.history,
    mySeat: seat,
    canUndo: a.canUndo(seat) && a.seats[seat ?? 0]?.kind === 'human',
    screen: a.state ? 'game' : 'lobby',
  });
  if (st.role === 'host' && sendMsg) {
    sendMsg({ t: 'lobby', seats: a.seats, started: !!a.state, room: a.room });
    if (a.state)
      for (const [peerId, pid] of peerPlayers) {
        const s = a.seats.findIndex((x) => x.ownerId === pid);
        const ps = s < 0 ? null : s;
        sendMsg({ t: 'state', view: a.engine.playerView(a.state, ps), seat: ps, canUndo: a.canUndo(ps), seq: a.seq }, peerId);
      }
  }
  scheduleBot();
}

/** Vista sin ocultar nada (sólo para desarrollo en la autoridad). */
function godView(s: GameState, seat: number | null): GameView {
  return { ...structuredClone(s), deckCount: s.deck.length, handCounts: Object.fromEntries(s.order.map((f) => [f, s.factions[f].hand.length])), viewer: seat };
}

function scheduleBot(force = false) {
  if (botTimer) clearTimeout(botTimer);
  botTimer = null;
  const a = authority;
  const st = useSession.getState();
  if (!a?.state || a.state.phase === 'fin' || (st.botsPaused && !force)) return;
  const seat = a.currentSeat()!;
  if (a.seats[seat].kind !== 'bot' && !force) return;
  botTimer = setTimeout(
    () => {
      if (!authority?.state) return;
      const s = authority.state;
      const m = greedyBot(authority.engine, s, lcg(authority.seed + s.moveCount * 7919));
      const err = authority.apply(authority.currentSeat()!, m);
      if (err) useSession.getState().toast_(`Bot: ${err}`);
      sync();
    },
    force ? 0 : st.botDelay,
  );
}

function hostOnMessage(msg: ToHost | ToPeer, peerId: string) {
  const a = authority!;
  const err = (e: string) => sendMsg?.({ t: 'reject', error: e }, peerId);
  const seatOfPeer = () => {
    const pid = peerPlayers.get(peerId);
    const i = pid ? a.seats.findIndex((s) => s.ownerId === pid) : -1;
    return i < 0 ? null : i;
  };
  switch (msg.t) {
    case 'hello': {
      peerPlayers.set(peerId, msg.playerId);
      sendMsg?.({ t: 'pack', input: a.input, hash: hashPack(a.input) }, peerId);
      const i = a.seats.findIndex((s) => s.ownerId === msg.playerId);
      if (i >= 0) a.seats[i].connected = true;
      break;
    }
    case 'claim': {
      const pid = peerPlayers.get(peerId);
      const t = a.seats[msg.seat];
      if (!pid || !t) return;
      if (t.ownerId && t.connected && t.ownerId !== pid) return err('Ese asiento está ocupado');
      for (const s of a.seats) if (s.ownerId === pid) Object.assign(s, { ownerId: null, connected: false, kind: 'bot' as const });
      Object.assign(t, { ownerId: pid, connected: true, kind: 'human' as const });
      break;
    }
    case 'intent': {
      const seat = seatOfPeer();
      if (seat === null) return err('No tenés asiento');
      const e = a.apply(seat, msg.move);
      if (e) return err(e);
      break;
    }
    case 'undo': {
      const seat = seatOfPeer();
      if (!a.canUndo(seat)) return err('No se puede deshacer');
      a.undo();
      break;
    }
    default:
      return;
  }
  sync();
}

function loadEngine(input: GamePackInput): { pack: GamePack | null; engine: Engine | null; issues: Issue[] } {
  const { pack, issues } = validatePack(input);
  if (!pack || issues.some((i) => i.level === 'error')) return { pack: null, engine: null, issues };
  return { pack, engine: createEngine(pack), issues };
}

export const useSession = create<Store>((set, get) => ({
  screen: 'menu',
  role: null,
  name: localStorage.getItem('mesa.name') ?? '',
  playerId: playerId(),
  packId: null,
  input: null,
  pack: null,
  engine: null,
  issues: [],
  usingDraft: false,
  seats: [],
  seed: (Math.random() * 1e9) >>> 0,
  room: null,
  view: null,
  full: null,
  history: [],
  mySeat: null,
  canUndo: false,
  peers: 0,
  toast: null,
  godView: false,
  botDelay: 500,
  botsPaused: false,
  devOpen: false,

  set: (p) => {
    set(p);
    if ('godView' in p || 'botsPaused' in p || 'botDelay' in p) sync();
  },
  setName(name) {
    localStorage.setItem('mesa.name', name);
    set({ name });
  },
  toast_(msg) {
    set({ toast: msg });
    setTimeout(() => get().toast === msg && set({ toast: null }), 4000);
  },

  setPack(input, opts = {}) {
    const { pack, engine, issues } = loadEngine(input);
    set({ input, issues, usingDraft: !!opts.draft });
    if (!pack || !engine) return get().toast_('El pack tiene errores: no se puede jugar (ver panel de desarrollo)');
    const sameGame = get().packId === pack.pack.id;
    set({ pack, engine, packId: pack.pack.id });
    if (!sameGame || !get().seats.length || get().seats.some((s) => !engine.factions[s.faction])) set({ seats: defaultSeats(pack) });
    if (authority && opts.replay !== false) {
      if (authority.seats.some((s) => !engine.factions[s.faction])) {
        authority.seats = get().seats;
        authority.engine = engine;
        authority.input = input;
        authority.state = null;
        get().toast_('Cambió el pack: una facción en juego ya no existe, volvemos al lobby');
      } else {
        const r = authority.reload(engine, input);
        get().toast_(r.error ? `Pack recargado: replay cortado en ${r.error}` : `Pack recargado · ${r.applied} moves re-jugados`);
        if (get().role === 'host') for (const peerId of peerPlayers.keys()) sendMsg?.({ t: 'pack', input, hash: hashPack(input) }, peerId);
      }
      sync();
    }
  },

  setSeats(seats) {
    set({ seats });
    if (authority && !authority.state) {
      authority.seats = structuredClone(seats);
      sync();
    }
  },
  setSeed(seed) {
    set({ seed });
    if (authority && !authority.state) authority.seed = seed;
  },

  startLocal() {
    const { engine, input, seats, seed } = get();
    if (!engine || !input) return;
    get().leave();
    authority = new Authority(engine, input, structuredClone(seats), seed, 'LOCAL');
    set({ role: 'local', room: null, screen: 'lobby' });
    sync();
  },

  createRoom() {
    const { engine, input, seats, seed, playerId: pid, name, packId } = get();
    if (!engine || !input || !packId) return;
    get().leave();
    const code = genRoomCode();
    const s = structuredClone(seats);
    Object.assign(s[0], { ownerId: pid, connected: true, kind: 'human', name: name || 'Host' });
    authority = new Authority(engine, input, s, seed, code);
    peerPlayers.clear();
    const r = openRoom(code, packId, hostOnMessage);
    r.onPeerJoin = () => set({ peers: Object.keys(r.getPeers()).length });
    r.onPeerLeave = (peerId) => {
      const pid2 = peerPlayers.get(peerId);
      peerPlayers.delete(peerId);
      const i = authority!.seats.findIndex((x) => x.ownerId === pid2);
      if (i >= 0) authority!.seats[i].connected = false;
      set({ peers: Object.keys(r.getPeers()).length });
      sync();
    };
    const url = new URL(location.href);
    url.searchParams.set('room', code);
    history.replaceState(null, '', url);
    set({ role: 'host', room: code, screen: 'lobby' });
    sync();
  },

  joinRoom(code) {
    const { packId } = get();
    code = code.trim().toUpperCase();
    if (!code || !packId) return;
    get().leave();
    hostPeerId = null;
    lastSeq = -1;
    const r = openRoom(code, packId, (msg, peerId) => {
      if (msg.t === 'hello' || msg.t === 'claim' || msg.t === 'intent' || msg.t === 'undo') return;
      if (hostPeerId && peerId !== hostPeerId) return;
      if (msg.t === 'pack') {
        hostPeerId = peerId;
        const { pack, engine, issues } = loadEngine(msg.input);
        set({ input: msg.input, pack, engine, issues });
      } else if (msg.t === 'lobby') {
        hostPeerId = peerId;
        set({ seats: msg.seats, room: msg.room, screen: msg.started ? get().screen : 'lobby' });
      } else if (msg.t === 'state') {
        if (msg.seq < lastSeq) return;
        lastSeq = msg.seq;
        set({ view: msg.view, mySeat: msg.seat, canUndo: msg.canUndo, screen: 'game' });
      } else if (msg.t === 'reject') get().toast_(msg.error);
    });
    r.onPeerJoin = (peerId) => {
      set({ peers: Object.keys(r.getPeers()).length });
      sendMsg?.({ t: 'hello', name: get().name || 'Invitado', playerId: get().playerId }, peerId);
    };
    r.onPeerLeave = () => set({ peers: Object.keys(r.getPeers()).length });
    set({ role: 'peer', room: code, screen: 'lobby' });
  },

  claimSeat(i) {
    if (get().role === 'peer') sendMsg?.({ t: 'claim', seat: i });
  },

  startGame() {
    if (!authority) return;
    authority.seats = structuredClone(get().seats.map((s, i) => ({ ...s, ...(authority!.seats[i]?.ownerId ? { ownerId: authority!.seats[i].ownerId, connected: authority!.seats[i].connected } : {}) })));
    authority.seed = get().seed;
    try {
      authority.start();
    } catch (e) {
      return get().toast_((e as Error).message);
    }
    sync();
  },

  send(m) {
    if (get().role === 'peer') return void sendMsg?.({ t: 'intent', move: m });
    if (!authority?.state) return;
    const seat = authority.currentSeat()!;
    const err = authority.apply(seat, m);
    if (err) get().toast_(err);
    sync();
  },

  undo() {
    if (get().role === 'peer') return void sendMsg?.({ t: 'undo' });
    const err = authority?.undo();
    if (err) get().toast_(err);
    sync();
  },

  restart() {
    if (!authority) return;
    authority.start();
    sync();
  },

  stepBot() {
    scheduleBot(true);
  },

  exportSave() {
    return authority?.state ? authority.save() : null;
  },

  loadSave(save) {
    const { engine, input } = get();
    if (!engine || !input) return;
    if (save.pack !== engine.pack.pack.id) return get().toast_(`El save es del pack "${save.pack}"`);
    get().leave();
    authority = new Authority(engine, input, save.seats, save.seed, 'LOCAL');
    authority.start();
    const r = replay(engine, save.seed, save.seats, save.history);
    authority.state = r.state;
    authority.history = save.history.slice(0, r.applied);
    set({ role: 'local', seats: save.seats, seed: save.seed });
    if (save.packHash !== hashPack(input)) get().toast_(`El pack cambió desde el save: ${r.error ? `replay cortado en ${r.error}` : 're-jugado completo'}`);
    sync();
  },

  leave() {
    room?.leave();
    room = null;
    sendMsg = null;
    authority = null;
    if (botTimer) clearTimeout(botTimer);
    set({ role: null, view: null, full: null, history: [], mySeat: null, screen: 'menu', room: null, peers: 0 });
  },
}));

/** Para depurar desde la consola / herramientas de automatización. */
(globalThis as Record<string, unknown>).__mesa = { session: useSession, authority: () => authority };
