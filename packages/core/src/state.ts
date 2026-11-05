/** Tipos del estado de partida. Todo es JSON serializable y determinista. */

export type FactionId = string;

export interface Card {
  id: number;
  suit: string;
  name: string;
}

export interface Piece {
  faction: FactionId;
  kind: string;
}

export interface Item {
  kind: string;
  exhausted: boolean;
}

export interface NodeState {
  id: number;
  warriors: Record<FactionId, number>;
  /** Edificios: ocupan slots y cuentan para el control. */
  buildings: Piece[];
  /** Fichas: no ocupan slots y no cuentan para el control. */
  tokens: Piece[];
}

export interface FactionState {
  id: FactionId;
  seat: number;
  playerName: string;
  vp: number;
  hand: Card[];
  warriorsSupply: number;
  buildingsSupply: number;
  tokensSupply: number;
  items?: Item[];
}

export type Phase = 'dia' | 'descarte' | 'fin';

export interface BattleResult {
  seq: number;
  node: number;
  attacker: FactionId;
  defender: FactionId;
  attackerRolls: number[];
  defenderRolls: number[];
  attackerHits: number;
  defenderHits: number;
}

export interface LogEntry {
  seq: number;
  turn: number;
  faction: FactionId | null;
  text: string;
}

export interface GameState {
  version: 1;
  pack: string;
  seed: number;
  rng: number;
  turn: number;
  current: number;
  phase: Phase;
  actionsLeft: number;
  freeBattle: boolean;
  effortUsed: boolean;
  specialUsed: boolean;
  battlesWon: number;
  order: FactionId[];
  factions: Record<FactionId, FactionState>;
  nodes: NodeState[];
  deck: Card[];
  discard: Card[];
  log: LogEntry[];
  lastBattle: BattleResult | null;
  winner: FactionId | null;
  moveCount: number;
  /** PV acumulados por facción y fuente (para análisis de balance). */
  stats: Record<FactionId, Record<string, number>>;
}

export interface GameView extends GameState {
  deckCount: number;
  handCounts: Record<FactionId, number>;
  viewer: number | null;
}

export type Move =
  | { type: 'mover'; from: number; to: number; count: number }
  | { type: 'reclutar'; node: number; card: number }
  | { type: 'construir'; node: number; card: number }
  | { type: 'encender'; node: number; card: number }
  | { type: 'batalla'; node: number; target: FactionId }
  | { type: 'especial'; node: number; card: number; target?: FactionId }
  | { type: 'scrapear' }
  | { type: 'finetune'; node: number; card: number }
  | { type: 'esfuerzo'; card: number }
  | { type: 'terminarDia' }
  | { type: 'descartar'; cards: number[] };

export interface PlayerConfig {
  faction: FactionId;
  name: string;
}

export interface GameConfig {
  seed: number;
  players: PlayerConfig[];
}

export type MoveResult = { ok: true; state: GameState } | { ok: false; error: string };
