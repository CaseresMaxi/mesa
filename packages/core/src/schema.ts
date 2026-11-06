import { z } from 'zod';

/**
 * Esquema de un "pack" de juego: todo lo que define un juego de mesa de control de área
 * (mapa, palos/cartas, reglas generales, facciones con sus habilidades declarativas y assets).
 * El pack vive en disco como varios JSON (pack/rules/map/cards/factions/assets) y en memoria
 * como un único objeto `GamePack`. Los patches del editor y de la IA apuntan a rutas de ese objeto.
 */

const Id = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, 'id en minúsculas: a-z, 0-9, _ y -');
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color #rrggbb');

// ───────────────────────── DSL: condiciones sobre un nodo ─────────────────────────

/** A quién se refiere una condición de piezas. `rivalArmy` excluye a los nómades. */
export const Owner = z.enum(['self', 'rival', 'rivalArmy', 'any']);
export const PieceSel = z.enum(['warrior', 'building', 'token', 'any']);

export type Cond =
  | { ruledBy: 'self' | 'rival' | 'none' | 'anyone' }
  | { has: z.infer<typeof PieceSel>; of: z.infer<typeof Owner>; min?: number }
  | { terrain: string }
  | { supply: 'warriors' | 'buildings' | 'tokens'; min?: number }
  | { neighbor: Cond }
  | { all: Cond[] }
  | { any: Cond[] }
  | { not: Cond }
  | { corner: boolean };

export const Cond: z.ZodType<Cond> = z.lazy(() =>
  z.union([
    z.strictObject({ ruledBy: z.enum(['self', 'rival', 'none', 'anyone']) }),
    z.strictObject({ has: PieceSel, of: Owner, min: z.int().min(1).optional() }),
    z.strictObject({ terrain: z.string() }),
    z.strictObject({ supply: z.enum(['warriors', 'buildings', 'tokens']), min: z.int().min(1).optional() }),
    z.strictObject({ neighbor: Cond }),
    z.strictObject({ all: z.array(Cond) }),
    z.strictObject({ any: z.array(Cond) }),
    z.strictObject({ not: Cond }),
    z.strictObject({ corner: z.boolean() }),
  ]),
);

// ───────────────────────── DSL: expresiones numéricas ─────────────────────────

export type Expr =
  | number
  | { count: 'nodes'; where: Cond }
  | { stat: 'battlesWon' | 'vp' | 'hand' | 'warriorsSupply' | 'buildingsSupply' | 'tokensSupply' | 'buildingsPlaced' | 'tokensPlaced' | 'items' | 'turn' }
  | { rivalsAt: 'pawn' }
  | { ref: string }
  | { div: [Expr, number] }
  | { mul: [Expr, number] }
  | { sum: Expr[] }
  | { min: Expr[] }
  | { max: Expr[] }
  | { table: number[]; of: Expr };

export const Expr: z.ZodType<Expr> = z.lazy(() =>
  z.union([
    z.number(),
    z.strictObject({ count: z.literal('nodes'), where: Cond }),
    z.strictObject({
      stat: z.enum(['battlesWon', 'vp', 'hand', 'warriorsSupply', 'buildingsSupply', 'tokensSupply', 'buildingsPlaced', 'tokensPlaced', 'items', 'turn']),
    }),
    z.strictObject({ rivalsAt: z.literal('pawn') }),
    z.strictObject({ ref: z.string() }),
    z.strictObject({ div: z.tuple([Expr, z.number().positive()]) }),
    z.strictObject({ mul: z.tuple([Expr, z.number()]) }),
    z.strictObject({ sum: z.array(Expr) }),
    z.strictObject({ min: z.array(Expr).min(1) }),
    z.strictObject({ max: z.array(Expr).min(1) }),
    z.strictObject({ table: z.array(z.number()).min(1), of: Expr }),
  ]),
);

// ───────────────────────── DSL: efectos ─────────────────────────

export const Effect = z.discriminatedUnion('do', [
  /** Agrega `amount` guerreros en cada nodo que cumpla `where` (en orden de id, hasta agotar reserva). */
  z.strictObject({ do: z.literal('placeWarriors'), where: Cond, amount: z.int().min(1).default(1), log: z.string().optional() }),
  /** Suma PV. `why` admite {vp} y variables. */
  z.strictObject({ do: z.literal('gainVp'), amount: Expr, why: z.string() }),
  z.strictObject({ do: z.literal('drawCards'), amount: z.int().min(1), log: z.string().optional() }),
  /** Nómade: recupera componentes quemados. */
  z.strictObject({ do: z.literal('refreshItems'), amount: z.int().min(1), log: z.string().optional() }),
  /** En el nodo del contexto, cambia 1 guerrero del rival con más guerreros por uno propio. */
  z.strictObject({ do: z.literal('convertWarrior'), log: z.string().optional() }),
  z.strictObject({ do: z.literal('log'), text: z.string() }),
]);
export type Effect = z.infer<typeof Effect>;

/** Requisito con mensaje de error para el jugador. */
export const Requirement = z.strictObject({ cond: Cond, error: z.string() });

/** Regla de puntuación de cierre de turno. `vars` se evalúan primero y se pueden usar en `vp` ({ref}) y en `why` ({nombre}). */
export const ScoreRule = z.strictObject({
  id: Id.optional(),
  vars: z.record(z.string(), Expr).optional(),
  vp: Expr,
  why: z.string(),
});

// ───────────────────────── archivos del pack ─────────────────────────

export const PackMeta = z.strictObject({
  $schema: z.string().optional(),
  id: Id,
  name: z.string(),
  version: z.string().default('0.1.0'),
  description: z.string().default(''),
  language: z.string().default('es'),
  players: z.strictObject({ min: z.int().min(1), max: z.int().min(1) }),
  /** Objetivos de balance que chequean `mesa sim` y la skill de balance. */
  balance: z
    .strictObject({
      games: z.int().min(10).default(300),
      /** Facciones por partida en la simulación (rotando combinaciones). */
      factionsPerGame: z.int().min(2).default(4),
      /** Win rate mínimo/máximo aceptable por facción. Default: 0.4/k y 1.8/k (k = facciones por partida). */
      minWinRate: z.number().min(0).max(1).optional(),
      maxWinRate: z.number().min(0).max(1).optional(),
      maxAvgTurns: z.number().positive().default(60),
    })
    .prefault({}),
});

export const Rules = z.strictObject({
  $schema: z.string().optional(),
  victoryVp: z.int().min(1),
  handLimit: z.int().min(1),
  startingHand: z.int().min(0),
  drawPerTurn: z.int().min(0).default(1),
  battle: z
    .strictObject({
      /** Valor del dado (d6) desde el que un dado es impacto. */
      hitOn: z.int().min(1).max(6).default(4),
      /** Impactos extra si el defensor no tiene guerreros. */
      undefendedBonus: z.int().min(0).default(1),
      /** PV por cada edificio/ficha rival destruida. */
      vpPerStructure: z.int().min(0).default(1),
    })
    .prefault({}),
  /** Esfuerzo (crunch): quemar una carta de este palo da 1 acción extra (1 vez por turno). */
  effort: z.strictObject({ suit: z.string() }).nullable().default(null),
  logLimit: z.int().min(10).default(300),
  /** Vocabulario del juego, para textos del log y la UI. */
  terms: z
    .strictObject({
      node: z.string().default('nodo'),
      nodes: z.string().default('nodos'),
      vp: z.string().default('PV'),
      turnStart: z.string().default('inicio'),
      actions: z.string().default('acciones'),
      close: z.string().default('cierre'),
      battle: z.string().default('batalla'),
      move: z.string().default('mover'),
      recruit: z.string().default('reclutar'),
      build: z.string().default('construir'),
      token: z.string().default('ficha'),
      effort: z.string().default('esfuerzo'),
    })
    .prefault({}),
  /** Plantillas de log opcionales (ver docs/DSL.md). */
  texts: z.record(z.string(), z.string()).default({}),
});

export const Terrain = z.strictObject({ id: Id, name: z.string(), color: Color, icon: z.string().optional() });

export const MapNode = z.strictObject({
  id: z.int().min(0),
  name: z.string(),
  terrain: z.string(),
  slots: z.int().min(0).max(6),
  /** Posición en el plano del tablero (unidades libres; el editor dibuja ~ -8..8). */
  x: z.number(),
  z: z.number(),
  corner: z.boolean().default(false),
});

export const GameMap = z.strictObject({
  $schema: z.string().optional(),
  id: Id,
  name: z.string(),
  terrains: z.array(Terrain).min(1),
  nodes: z.array(MapNode).min(2),
  edges: z.array(z.tuple([z.int().min(0), z.int().min(0)])),
  /** Esquinas de inicio por asiento (asiento 0 → startCorners[0]). */
  startCorners: z.array(z.int().min(0)).min(1),
  /** Nodo central (los nómades arrancan acá si su setup dice "center"). */
  center: z.int().min(0).optional(),
  /** Decoración libre para el render (ríos, bosques...). */
  decor: z.record(z.string(), z.unknown()).optional(),
});

export const Suit = z.strictObject({
  id: Id,
  name: z.string(),
  color: Color,
  /** Comodín: paga en cualquier nodo. */
  wild: z.boolean().default(false),
  icon: z.string().optional(),
});

export const DeckGroup = z.strictObject({
  suit: z.string(),
  count: z.int().min(1),
  /** Nombres que se reparten en ciclo dentro del grupo. */
  names: z.array(z.string()).min(1),
});

export const Cards = z.strictObject({
  $schema: z.string().optional(),
  suits: z.array(Suit).min(1),
  deck: z.array(DeckGroup).min(1),
  /** Texto de ambientación por nombre de carta (opcional). */
  flavor: z.record(z.string(), z.string()).default({}),
});

const SetupStep = z.strictObject({
  at: z.union([z.enum(['corner', 'cornerNeighbors', 'center']), z.strictObject({ node: z.int().min(0) })]),
  warriors: z.int().min(0).default(0),
  building: z.boolean().default(false),
  token: z.boolean().default(false),
});

export const ItemDef = z.strictObject({ id: Id, name: z.string(), verb: z.string(), hint: z.string() });

export const Nomad = z.strictObject({
  items: z.array(ItemDef).min(1),
  startItems: z.array(z.string()),
  maxItems: z.int().min(1),
  refreshPerTurn: z.int().min(0),
  /** Qué componente quema cada acción del nómade. */
  actionItems: z.strictObject({ move: z.string(), battle: z.string(), draw: z.string(), finetune: z.string() }),
  /** Dados en batalla = cantidad de este componente (máx. 3). */
  battleDiceItem: z.string(),
  finetuneVp: z.int().min(0),
  aidVp: z.int().min(0),
  /** Componente que se gana al fine-tunear con una carta de cada palo. */
  suitItem: z.record(z.string(), z.string()),
  burnOrder: z.array(z.string()),
  refreshOrder: z.array(z.string()),
});

export const Special = z.strictObject({
  name: z.string(),
  hint: z.string(),
  /** Requisitos sobre el nodo elegido (además de: acción, carta que paga, guerreros propios ahí). */
  requires: z.array(Requirement).default([]),
  effects: z.array(Effect).default([]),
});

export const Faction = z.strictObject({
  id: Id,
  name: z.string(),
  short: z.string(),
  tagline: z.string().default(''),
  color: Color,
  archetype: z.enum(['standard', 'nomad']).default('standard'),
  warriors: z.strictObject({ count: z.int().min(1), name: z.string(), singular: z.string() }),
  building: z
    .strictObject({ kind: Id, name: z.string(), count: z.int().min(1), vp: z.array(z.int().min(0)).min(1) })
    .nullable()
    .default(null),
  token: z
    .strictObject({
      kind: Id,
      name: z.string(),
      count: z.int().min(1),
      /** Dónde se puede colocar (además de no repetir en el mismo nodo). */
      requires: z.array(Requirement).default([]),
    })
    .nullable()
    .default(null),
  actions: z.int().min(0).default(3),
  recruit: z
    .strictObject({ amount: z.int().min(1), requires: z.array(Requirement).default([]) })
    .nullable()
    .default(null),
  move: z.strictObject({ range: z.int().min(1).default(1), needsRule: z.boolean().default(true) }).prefault({}),
  battle: z
    .strictObject({
      maxDice: z.int().min(0).max(6).default(3),
      /** Una batalla gratis por turno. */
      free: z.boolean().default(false),
      defenseBonus: z.int().min(0).default(0),
      vpPerWarriorKill: z.int().min(0).default(0),
    })
    .prefault({}),
  /** Cualquier carta paga en cualquier nodo. */
  anyCard: z.boolean().default(false),
  special: Special.nullable().default(null),
  setup: z.array(SetupStep).default([]),
  onTurnStart: z.array(Effect).default([]),
  onClose: z.array(ScoreRule).default([]),
  nomad: Nomad.optional(),
  /** Resumen de reglas de la facción (texto para la UI). */
  summary: z.array(z.string()).default([]),
});

export const Factions = z.strictObject({ $schema: z.string().optional(), factions: z.array(Faction).min(1) });

/** Receta de asset: el generador de @mesa/art la convierte en SVG. */
export const AssetEntry = z.strictObject({
  id: z.string(),
  name: z.string().optional(),
  category: z.string(),
  recipe: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
  /** Archivo SVG/PNG propio que reemplaza a la receta (ruta relativa al pack). */
  file: z.string().optional(),
  w: z.int().min(1).optional(),
  h: z.int().min(1).optional(),
});

export const Assets = z.strictObject({
  $schema: z.string().optional(),
  style: z
    .strictObject({ ink: Color.default('#2b2118'), paper: Color.default('#f4ead2'), roughness: z.number().min(0).max(4).default(1.1) })
    .prefault({}),
  /** Si es true, `mesa assets` agrega automáticamente cartas, fichas, edificios y tablero a partir del pack. */
  auto: z.boolean().default(true),
  entries: z.array(AssetEntry).default([]),
});

// ───────────────────────── animaciones (peleas) ─────────────────────────

/** Quién protagoniza un efecto: el bando atacante, el defensor o el nodo de la pelea. */
export const FxWho = z.enum(['attacker', 'defender', 'node']);
/** Cuándo corre un paso según el resultado de la pelea. */
export const FxWhen = z.enum(['always', 'attackerWins', 'defenderWins', 'draw', 'undefended', 'attackerLost', 'defenderLost', 'noLosses']);
export const FxEase = z.enum(['linear', 'in', 'out', 'inOut', 'back', 'bounce']);

const stepBase = {
  /** Inicio en ms desde el comienzo del clip. */
  at: z.number().min(0).default(0),
  /** Duración en ms. */
  dur: z.number().min(1).default(400),
  when: FxWhen.default('always'),
  ease: FxEase.default('inOut'),
};
const ColorOrSide = z.union([Color, z.enum(['attacker', 'defender'])]);

export const FxStep = z.discriminatedUnion('fx', [
  /** Las figuras de un bando se lanzan hacia el rival y vuelven. */
  z.strictObject({ fx: z.literal('lunge'), ...stepBase, who: FxWho.exclude(['node']).default('attacker'), dist: z.number().default(60) }),
  /** Temblor. */
  z.strictObject({ fx: z.literal('shake'), ...stepBase, who: FxWho.default('defender'), amp: z.number().default(10) }),
  /** Destello de color sobre las figuras. */
  z.strictObject({ fx: z.literal('flash'), ...stepBase, who: FxWho.default('defender'), color: ColorOrSide.default('#ffffff') }),
  /** Proyectiles de un bando al otro: un asset del pack (ej. "token-google") o una forma dibujada. */
  z.strictObject({
    fx: z.literal('projectile'),
    ...stepBase,
    from: FxWho.exclude(['node']).default('attacker'),
    asset: z.string().optional(),
    shape: z.enum(['orb', 'bolt', 'arrow', 'star']).default('orb'),
    color: ColorOrSide.default('attacker'),
    count: z.number().int().min(1).max(12).default(3),
    size: z.number().default(22),
    /** Altura del arco (0 = recto). */
    arc: z.number().default(60),
  }),
  /** Explosión de partículas. */
  z.strictObject({
    fx: z.literal('burst'),
    ...stepBase,
    who: FxWho.default('defender'),
    color: ColorOrSide.default('#ffcf4a'),
    count: z.number().int().min(1).max(60).default(16),
    radius: z.number().default(90),
  }),
  /** Onda expansiva. */
  z.strictObject({ fx: z.literal('ring'), ...stepBase, who: FxWho.default('node'), color: ColorOrSide.default('#ffffff'), radius: z.number().default(140) }),
  /** Los dados ruedan y caen en las tiradas reales. */
  z.strictObject({ fx: z.literal('dice'), ...stepBase, size: z.number().default(46) }),
  /** Las bajas caen y se desvanecen, con "-N" flotando. */
  z.strictObject({ fx: z.literal('casualties'), ...stepBase }),
  /** Texto. Variables: {attacker} {defender} {ah} {dh} {aLoss} {dLoss} {node}. */
  z.strictObject({
    fx: z.literal('text'),
    ...stepBase,
    who: FxWho.default('node'),
    text: z.string(),
    color: ColorOrSide.default('#2b2118'),
    size: z.number().default(44),
  }),
]);

export const FxClip = z.strictObject({
  description: z.string().default(''),
  steps: z.array(FxStep).min(1),
});

export const Animations = z.strictObject({
  $schema: z.string().optional(),
  /** false = el cliente no anima las peleas (los jugadores también pueden apagarlas). */
  enabled: z.boolean().default(true),
  /** Multiplicador global de velocidad (2 = el doble de rápido). */
  speed: z.number().min(0.1).max(10).default(1),
  /** Biblioteca de clips con nombre. */
  clips: z.record(Id, FxClip).default({}),
  battle: z
    .strictObject({
      /** Clip por defecto para cualquier pelea (vacío = el clip incorporado "clasico"). */
      default: z.string().default(''),
      /** Clip según la facción atacante (pisa al default). */
      byAttacker: z.record(Id, z.string()).default({}),
    })
    .prefault({}),
});

/** Pack en memoria. Ojo: `factions` es directamente la lista (en disco va envuelta en `{ factions: [...] }`). */
export const GamePack = z.strictObject({
  pack: PackMeta,
  rules: Rules,
  map: GameMap,
  cards: Cards,
  factions: z.array(Faction).min(1),
  assets: Assets,
  animations: Animations.prefault({}),
});

export type PackMeta = z.infer<typeof PackMeta>;
export type Rules = z.infer<typeof Rules>;
export type GameMap = z.infer<typeof GameMap>;
export type MapNode = z.infer<typeof MapNode>;
export type Cards = z.infer<typeof Cards>;
export type Faction = z.infer<typeof Faction>;
export type Factions = z.infer<typeof Factions>;
export type Assets = z.infer<typeof Assets>;
export type AssetEntry = z.infer<typeof AssetEntry>;
export type Requirement = z.infer<typeof Requirement>;
export type ScoreRule = z.infer<typeof ScoreRule>;
export type Special = z.infer<typeof Special>;
export type NomadDef = z.infer<typeof Nomad>;
export type FxStep = z.infer<typeof FxStep>;
export type FxClip = z.infer<typeof FxClip>;
export type FxWhen = z.infer<typeof FxWhen>;
export type Animations = z.infer<typeof Animations>;
export type GamePack = z.infer<typeof GamePack>;
/** Pack tal como está escrito en disco (con defaults sin aplicar). */
export type GamePackInput = z.input<typeof GamePack>;

/** Archivos del pack en disco ↔ clave en el objeto GamePack. */
export const PACK_FILES = {
  pack: 'pack.json',
  rules: 'rules.json',
  map: 'map.json',
  cards: 'cards.json',
  factions: 'factions.json',
  assets: 'assets/manifest.json',
  animations: 'animations.json',
} as const;
export type PackFileKey = keyof typeof PACK_FILES;

export const SCHEMAS = { pack: PackMeta, rules: Rules, map: GameMap, cards: Cards, factions: Factions, assets: Assets, animations: Animations } as const;

/** JSON Schema de cada archivo (para VS Code, el editor y la IA). */
export function jsonSchemas(): Record<PackFileKey | 'batch', unknown> {
  const out = {} as Record<string, unknown>;
  for (const [k, s] of Object.entries(SCHEMAS)) out[k] = z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' });
  out.batch = z.toJSONSchema(Batch, { io: 'input', unrepresentable: 'any' });
  return out as Record<PackFileKey | 'batch', unknown>;
}

// ───────────────────────── lotes (batches) del editor para la IA ─────────────────────────

export const PatchOp = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('replace'), path: z.string(), value: z.unknown(), from: z.unknown().optional() }),
  z.strictObject({ op: z.literal('add'), path: z.string(), value: z.unknown() }),
  z.strictObject({ op: z.literal('remove'), path: z.string(), from: z.unknown().optional() }),
]);
export type PatchOp = z.infer<typeof PatchOp>;

export const BatchItem = z.discriminatedUnion('kind', [
  /** Cambios concretos ya decididos (el editor los genera desde el diff). */
  z.strictObject({
    id: z.string(),
    kind: z.literal('patch'),
    title: z.string(),
    note: z.string().default(''),
    ops: z.array(PatchOp).min(1),
    status: z.enum(['pending', 'applied', 'rejected']).default('pending'),
  }),
  /** Intención en lenguaje natural para que la IA la resuelva (ej. "Google gana demasiado: bajarla a ~25%"). */
  z.strictObject({
    id: z.string(),
    kind: z.literal('intent'),
    title: z.string(),
    text: z.string(),
    /** Rutas del pack sobre las que se espera actuar (pista para la IA). */
    targets: z.array(z.string()).default([]),
    /** Restricciones: "no tocar el mapa", "máx. ±2 por número", etc. */
    constraints: z.array(z.string()).default([]),
    /** Cómo verificar: "sim", "tests", "visual". */
    verify: z.array(z.enum(['validate', 'sim', 'assets', 'visual'])).default(['validate']),
    status: z.enum(['pending', 'applied', 'rejected']).default('pending'),
    result: z.string().optional(),
  }),
]);
export type BatchItem = z.infer<typeof BatchItem>;

export const Batch = z.strictObject({
  $schema: z.string().optional(),
  format: z.literal('mesa-batch'),
  version: z.literal(1),
  pack: z.string(),
  title: z.string(),
  createdAt: z.string(),
  /** Instrucciones generales para quien procese el lote. */
  notes: z.string().default(''),
  items: z.array(BatchItem),
});
export type Batch = z.infer<typeof Batch>;
