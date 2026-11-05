---
name: balance
description: Medir y ajustar el balance de un pack del motor mesa con simulaciones de bots (win rate por facción y por asiento, duración, fuentes de PV), barridos de parámetros y comparación contra baseline. Usar para "¿está balanceado?", "X gana demasiado", "las partidas duran mucho", "probá valores de...", o después de cualquier cambio de reglas/mapa.
---

# Balance

## Medir

- `pnpm mesa sim <pack>` → tabla: win% por facción, Δ contra `reports/baseline.json` (si existe), PV promedio y
  **fuentes de PV** (`build`, `close:<id>`, `special`, `structures`, `kills`, `finetune`, `turnStart`),
  win% por asiento, turnos promedio, bloqueos y **avisos** contra los objetivos de `pack.json → balance`
  (default: win% entre 0.4/k y 1.8/k con k facciones por partida; turnos ≤ maxAvgTurns; asiento ±10 pts del justo).
- Opciones: `--games 600` (más precisión: ±3 pts con 300 partidas, ±2 con 600), `--k 3`, `--factions a,b,c`,
  `--json`, `--save <nombre>`, `--vs <nombre>`.
- Barrido: `pnpm mesa sweep <pack> --path /factions/google/warriors/count --values 14,16,18,20 --games 200`
  (muestra win% de la facción de la ruta, rango del resto, turnos y avisos por valor).
- Los bots son codiciosos con ruido (`greedyBot` en `packages/core/src/sim.ts`): miden **ventajas estructurales**
  (economía, PV fáciles, mapa, orden de turno), no profundidad estratégica. Decilo al reportar.

## Ajustar (orden recomendado)

1. Corré una sim de referencia y guardala si no hay baseline: `--save baseline`.
2. Identificá la causa con las fuentes de PV, no sólo el win%: una facción que gana por una sola fuente enorme
   (ej. `close:precio-bajo 11`) se corrige en esa fuente.
3. Palancas de menor a mayor impacto: pista de PV de edificios (`building.vp`), divisores/tablas de `onClose`,
   `recruit.amount`, `warriors.count`, `battle.*`, `move.*`, `actions`, `victoryVp`. Cambiá **una cosa por vez**.
4. Usá `sweep` para elegir el valor; confirmá con `sim --games 600`.
5. Si el problema es de **asiento** (ej. "Asiento 2 gana 46%"), es mapa/orden: mirá `pnpm mesa map analyze <pack>`
   (`cornerReach`, `cornerDistances`) y ajustá esquinas/conexiones (skill `mapas`) o `startCorners`.
6. Al terminar: `pnpm test` (incluye el test de balance de todos los packs) y, si el usuario lo aprueba,
   `pnpm mesa sim <pack> --save baseline`.

## Reportar

Tabla antes/después (win% por facción, turnos, asientos), qué se cambió (rutas y valores), por qué (fuente de PV/causa),
margen de error de la muestra, y lo que queda pendiente. No declares "balanceado" con menos de 300 partidas.

Hallazgo conocido en carrera-neural: el asiento 2 (esquina Robótica) gana ~46% con los bots en todas las facciones.
