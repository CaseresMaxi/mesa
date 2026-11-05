---
name: reglas
description: Diseñar o modificar reglas y facciones de un pack del motor mesa usando el DSL declarativo (condiciones, expresiones, efectos, puntuación de cierre, especiales, setup, nómades), y extender el DSL si hace falta. Usar para "agregá una facción", "cambiá cómo puntúa X", "que Y pueda reclutar en...", "nueva carta/palo", "cambiá los PV para ganar".
---

# Reglas y facciones

Referencia completa: `docs/DSL.md`. Fuente de verdad de la forma: `packages/core/src/schema.ts`.
Ejemplos reales de cada primitiva: `packs/carrera-neural/factions.json` (Google = efecto de inicio + especial con
`convertWarrior`; Meta = especial con requisito compuesto; Anthropic = bonus de batalla y PV por bajas;
OpenAI = fichas con requisito `neighbor` + puntuación por tabla; DeepSeek = `anyCard` + dos reglas de cierre;
Redditor = arquetipo `nomad`).

## Flujo

1. Leé la facción/regla actual: `pnpm mesa get <pack> /factions/<id>` y `pnpm mesa doc <pack>` (traducción a texto).
2. Escribí el cambio como **patch** (preferido, queda trazable) o editando el JSON:
   `pnpm mesa patch <pack> '[{"op":"replace","path":"/factions/meta/recruit/amount","value":3}]' --dry` → sin `--dry` para guardar.
   Agregar facción: `{"op":"add","path":"/factions/-","value":{...}}`.
3. `pnpm mesa validate <pack>` (errores de forma con ruta exacta + coherencia: terrenos, refs de vars, setup, nómade).
4. Probá que se juega: `pnpm mesa play <pack> --factions a,b,c --seed 3 --log 60` y leé el log
   (¿la habilidad se dispara? ¿los textos tienen sentido?).
5. Medí el impacto: skill `balance` (`pnpm mesa sim <pack>`; compará con baseline).
6. Actualizá `summary` de la facción para que diga exactamente lo que hace la mecánica, y `pnpm mesa doc` para verificarlo.

## Diseño de una facción nueva (checklist)

- Identidad: `id`, `name`, `short`, `tagline`, `color` distinto de las demás.
- Economía: `warriors.count` (8–20), `actions` (3), cómo crece (`recruit` o `onTurnStart: placeWarriors`), `building`
  con pista de PV creciente (suma total ≈ 10–14) y/o `token`.
- **Una fuente de PV propia** en `onClose` (con `id` para que aparezca en reportes) — es lo que la hace jugar distinto.
- Un rasgo asimétrico (`move.range`, `move.needsRule: false`, `battle.*`, `anyCard`, `special`).
- `setup` en `corner` (y opcional `cornerNeighbors`).
- Texto `summary` de 3–5 líneas.
- Arrancá con números conservadores y ajustá con `mesa sweep` (skill balance).

## Cuando el DSL no alcanza

Si la mecánica no se puede expresar: agregá la primitiva genérica mínima en `schema.ts` (Cond/Expr/Effect) y su
evaluación en `packages/core/src/engine.ts` (`cond`, `expr` o `runEffects`), chequeo en `semanticIssues` (pack.ts) si
aplica, documentala en `docs/DSL.md`, test en `packages/core/test/core.test.ts`, `pnpm mesa schema`, y `pnpm test`
(el test de **paridad** con root-3d tiene que seguir pasando: no cambies comportamiento existente).
No metas lógica específica de una facción en el motor (`if (f === 'x')`): siempre parametrizado por datos.
