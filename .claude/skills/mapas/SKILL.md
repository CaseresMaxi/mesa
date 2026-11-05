---
name: mapas
description: Crear, generar, analizar o modificar mapas (nodos, conexiones, terrenos, slots, esquinas de inicio) de un pack del motor mesa. Usar para pedidos como "haceme un mapa de 12 regiones", "equilibrá las esquinas", "agregá un nodo central", "el asiento 2 está favorecido".
---

# Mapas

El mapa está en `packs/<id>/map.json` (`/map`): `terrains`, `nodes` (`id` = índice, `name`, `terrain`, `slots` 0–6,
`x`/`z` ~ -8..8, `corner`), `edges` (pares de ids), `startCorners` (esquina por asiento), `center`.

## Herramientas

- `pnpm mesa map analyze <pack>` → grado prom./mín./máx., diámetro, `chokepoints`, `cornerDistances`,
  `cornerReach` (nodos a ≤1 y ≤2 de cada esquina), terrenos y slots por terreno, `sameTerrainEdges`, `crossings`.
- `pnpm mesa map generate <pack> --seed N --nodes N --corners N --degree 3.1 [--apply]` → mapa plano, conexo y con
  terrenos balanceados; conserva terrenos y nombres actuales. Sin `--apply` sólo imprime: probá varias semillas y elegí.
- Cambios puntuales: `pnpm mesa patch <pack> '[{"op":"replace","path":"/map/nodes/3/slots","value":2}]'`
  o `{"op":"add","path":"/map/edges/-","value":[2,7]}`. Si borrás un nodo hay que reindexar ids, edges,
  `startCorners`, `center` y los `setup` con `{"node": n}` (el editor lo hace solo; a mano, con cuidado).
- Render: `pnpm mesa assets <pack> --only board` y mirá `packs/<pack>/assets/generated/board.svg`
  (rasterizá con `rsvg-convert board.svg -w 1000 -o /ruta/scratch/board.png` y leé la imagen).

## Criterios de un buen mapa (chequealos con `analyze`)

- Conexo, `crossings: 0`, sin callejones de grado 1 salvo que sea a propósito; grado prom. 2.8–3.6.
- **Esquinas simétricas**: `cornerReach` parecido para todos los asientos (±1) y `cornerDistances` sin outliers;
  las esquinas que se enfrentan a distancia ≤2 generan pelea temprana.
- Terrenos balanceados (±1 nodo) y slots por terreno parecidos; pocas `sameTerrainEdges`.
- 1–3 nodos centrales de grado alto (puntos de disputa), ningún `chokepoint` accidental.
- Diámetro ≤ 5 para 10–14 nodos.

## Verificar el impacto en el juego

Después de cambiar el mapa: `pnpm mesa validate <pack>` y `pnpm mesa sim <pack>` — mirá especialmente la línea
`asientos:` (ventaja por posición) y los avisos. Compará contra `reports/baseline.json` si existe.
Si el usuario pide un mapa nuevo para el mismo juego, generá 3–5 candidatos, quedate con el que mejor cumpla los
criterios y mostralo (imagen del tablero + métricas clave) antes de dar por terminado.
