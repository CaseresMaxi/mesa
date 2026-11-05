# mesa — motor de juegos de mesa data-driven

- Monorepo pnpm, TypeScript 7 (sin build: Node 26 ejecuta `.ts` directo; imports con extensión `.ts`; sin enums,
  namespaces ni parameter properties — `erasableSyntaxOnly`).
- `packages/core`: esquema zod (`schema.ts` = fuente de verdad), motor genérico (`engine.ts`), pack/validación,
  rutas por id + patches + diff, lotes, simulación de balance, generador/análisis de mapas. `@mesa/core/node` = fs.
- `packages/art`: assets SVG dibujados a mano (rough.js). `packages/cli`: `pnpm mesa …`. `packages/editor`: editor (5180).
- `packages/play`: cliente web genérico que juega cualquier pack (5181): hotseat + bots, online P2P (Trystero), hot-reload con
  replay del historial, panel Dev; build estático por pack. `packages/devserver`: API local `/api` + SSE compartida por ambos.
- `pnpm dev` levanta editor + juego. Para probar en el navegador ver la skill `probar-web`.
- `packs/<id>/`: un juego = datos (ver `docs/DSL.md`). `packs/carrera-neural` es el port del juego de `../root-3d`;
  `packages/core/test/parity.test.ts` garantiza que juega idéntico al motor original: no lo rompas.
- Skills en `.claude/skills/`: nuevo-juego, mapas, assets, reglas, balance, aplicar-lote, probar-web.
- Antes de terminar un cambio: `pnpm mesa validate <pack>` (si tocaste datos), `pnpm typecheck`, `pnpm test`.
- Si cambiás `schema.ts`: `pnpm mesa schema` y actualizá `docs/DSL.md`.
- Textos de UI, logs y docs en castellano rioplatense.
