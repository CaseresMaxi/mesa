# Formato de pack y DSL de reglas

Un **pack** es un juego completo descrito con datos. Vive en `packs/<id>/`:

| Archivo | Clave en memoria | Qué define |
|---|---|---|
| `pack.json` | `/pack` | id, nombre, jugadores, objetivos de balance |
| `rules.json` | `/rules` | PV para ganar, mano, batalla, esfuerzo, vocabulario y textos del log |
| `map.json` | `/map` | terrenos, nodos, conexiones, esquinas de inicio, centro |
| `cards.json` | `/cards` | palos (y comodines) y grupos del mazo |
| `factions.json` | `/factions` (¡la lista directa!) | facciones con sus habilidades en DSL |
| `assets/manifest.json` | `/assets` | estilo del arte y overrides de assets |
| `animations.json` (opcional) | `/animations` | clips de animación de las peleas y cuál usa cada facción (ver skill `animaciones`) |

Los JSON Schema están en `schemas/` (`pnpm mesa schema` los regenera desde `packages/core/src/schema.ts`,
que es la fuente de verdad). Validá siempre con `pnpm mesa validate <pack>`.

## Rutas por id

Patches, lotes, `mesa get` y `mesa sweep` usan rutas tipo JSON Pointer donde, en listas de objetos con `id`,
el segmento puede ser el id: `/factions/google/battle/maxDice`, `/map/nodes/3/slots`,
`/factions/meta/onClose/0/vp`, `/cards/deck/2/count`. En un `add`, `-` agrega al final: `/map/edges/-`.

## Modelo de juego (motor `standard`)

- Turno: **inicio** (`onTurnStart`) → **acciones** (`actions`, cada move gasta 1) → **cierre** (`onClose`, robar `drawPerTurn`, descartar hasta `handLimit`).
- **Gobernar** un nodo: más guerreros + edificios que cualquier otra facción (empate = nadie; los nómades nunca gobiernan).
- Una carta **paga** en un nodo si su palo es el terreno del nodo, es comodín (`wild`), o la facción tiene `anyCard`.
- Moves: `mover` (alcance `move.range`; si `move.needsRule` hay que gobernar origen o destino), `reclutar` (paga carta,
  `recruit.amount` guerreros donde se cumplan `recruit.requires`), `construir` (paga carta, hay que gobernar, slot libre;
  da `building.vp[i]` PV), `encender` (coloca ficha: paga carta, `token.requires`, una por nodo), `especial` (1/turno,
  paga carta, guerreros propios ahí, `special.requires`, ejecuta `special.effects`), `batalla`, `esfuerzo`
  (quemar carta del palo `rules.effort.suit` → +1 acción), `terminarDia`.
- **Batalla**: atacante y defensor tiran `min(guerreros, battle.maxDice)` d6; `rules.battle.hitOn`+ = impacto.
  Defensor sin guerreros: +`undefendedBonus` al atacante; defensor con guerreros: +`defenseBonus` propio.
  Los impactos sacan guerreros, después edificios, después fichas. Cada edificio/ficha caída da `vpPerStructure` PV
  y cada guerrero eliminado `vpPerWarriorKill` (del que pega).

### Arquetipo `nomad`

Un solo peón que no gobierna ni muere. No usa `actions`: cada move quema un componente de `nomad.actionItems`
(`move`, `battle` (dados = cantidad de `battleDiceItem`, máx 3), `draw` = move `scrapear`, `finetune` = pagar carta
del nodo → componente según `suitItem` y `finetuneVp` PV). `especial` = **ayudar**: regala una carta a un rival en su nodo,
quema un componente (`burnOrder`), +`aidVp` PV. Recupera `refreshPerTurn` al inicio (`refreshOrder`); `esfuerzo` recupera 1.
Los golpes recibidos queman componentes.

## Condiciones (`Cond`) — se evalúan sobre un nodo

| Forma | Verdadero si… |
|---|---|
| `{ "ruledBy": "self" \| "rival" \| "none" \| "anyone" }` | quién gobierna el nodo |
| `{ "has": "warrior" \| "building" \| "token" \| "any", "of": "self" \| "rival" \| "rivalArmy" \| "any", "min": 1 }` | hay ≥min piezas de ese tipo/dueño (`rivalArmy` = rivales no nómades) |
| `{ "terrain": "datos" }` | el nodo es de ese terreno |
| `{ "supply": "warriors" \| "buildings" \| "tokens", "min": 1 }` | a la facción le quedan ≥min en reserva |
| `{ "corner": true }` | el nodo es esquina |
| `{ "neighbor": Cond }` | algún vecino cumple |
| `{ "all": [Cond…] }`, `{ "any": [Cond…] }`, `{ "not": Cond }` | lógica |

## Expresiones (`Expr`) — números

| Forma | Valor |
|---|---|
| `3` | literal |
| `{ "count": "nodes", "where": Cond }` | cantidad de nodos que cumplen |
| `{ "stat": "battlesWon" \| "vp" \| "hand" \| "warriorsSupply" \| "buildingsSupply" \| "tokensSupply" \| "buildingsPlaced" \| "tokensPlaced" \| "items" \| "turn" }` | dato de la facción/turno (`battlesWon` = batallas ganadas este turno) |
| `{ "rivalsAt": "pawn" }` | rivales con piezas en el nodo del peón (nómades) |
| `{ "ref": "n" }` | variable de `vars` |
| `{ "div": [Expr, 3] }` | división entera (piso) |
| `{ "mul": [Expr, 2] }`, `{ "sum": [...] }`, `{ "min": [...] }`, `{ "max": [...] }` | aritmética |
| `{ "table": [0,1,2,2,3], "of": Expr }` | busca en tabla (índice acotado al largo) |

## Efectos (`Effect`)

| `do` | Campos | Qué hace |
|---|---|---|
| `placeWarriors` | `where: Cond`, `amount`, `log?` (`{n}`) | +amount guerreros en cada nodo que cumple (en orden de id, hasta agotar reserva) |
| `gainVp` | `amount: Expr`, `why` (`{vp}`, `{node}`) | suma PV |
| `drawCards` | `amount`, `log?` | roba cartas |
| `refreshItems` | `amount`, `log?` | (nómade) recupera componentes |
| `convertWarrior` | `log?` (`{victim}`, `{node}`) | en el nodo del especial: 1 guerrero del rival (no nómade) con más guerreros pasa a ser tuyo |
| `log` | `text` (`{node}`) | sólo texto en el log |

Se usan en `onTurnStart` (sin nodo) y en `special.effects` (nodo = el elegido).

## Puntuación de cierre (`onClose`)

```json
{ "id": "monopolio",
  "vars": { "ruled": { "count": "nodes", "where": { "ruledBy": "self" } } },
  "vp": { "div": [{ "ref": "ruled" }, 3] },
  "why": "monopolio en {ruled} mercados (1 PV cada 3)" }
```

`vars` se evalúan primero; `vp` puede referenciarlas con `{ref}` y `why` interpolarlas con `{nombre}` (además de `{vp}`).
El `id` aparece en los reportes de balance como fuente `close:<id>`.

## Requisitos

`recruit.requires`, `token.requires` y `special.requires` son listas de `{ "cond": Cond, "error": "mensaje para el jugador" }`;
se chequean en orden y el primero que falla da el error.

## Setup

`setup` es una lista de pasos `{ "at": "corner" | "cornerNeighbors" | "center" | { "node": 4 }, "warriors": n, "building": bool, "token": bool }`.
`corner` es la esquina del asiento (`map.startCorners[asiento]`).

## Textos

`rules.terms` da el vocabulario (`node`, `battle`, `effort`, `vp`…) y `rules.texts` pisa plantillas del log. Claves:
`start, reshuffle, vp, win, turn, mustDiscard, battle, move, recruit, build, token, effort, endTurn, discard,
whyStructures, whyKills, nomadMove, nomadDraw, nomadFinetune, whyFinetune, nomadAid, nomadEffort, nomadRefresh, nomadHit`
(ver `packages/core/src/engine.ts` para las variables de cada una).

## ¿Y si la mecánica que quiero no entra en el DSL?

Agregá una primitiva nueva en `packages/core/src/schema.ts` (Cond/Expr/Effect) + su evaluación en `engine.ts`,
documentala acá, agregá un test en `packages/core/test/`, y corré `pnpm test` (el test de paridad garantiza que
Carrera Neural sigue jugando igual). Preferí primitivas genéricas y reutilizables antes que casos especiales por facción.
