---
name: nuevo-juego
description: Crear un juego de mesa nuevo (pack) en el motor mesa a partir de una idea, de otro pack o de la plantilla mínima. Usar cuando el usuario quiere arrancar un juego, una variante o una expansión con mapa, cartas y facciones propias.
---

# Crear un juego nuevo

Un juego es un **pack** de datos en `packs/<id>/` (ver `docs/DSL.md`). No hace falta tocar código del motor salvo
que la idea necesite una mecánica que el DSL no tiene.

## Pasos

1. **Entender la idea** (en 4–6 líneas): tema, cantidad de jugadores, cómo se gana, 2–6 facciones con un rasgo cada una,
   qué representan los nodos y los palos de cartas. Si falta algo esencial, preguntá una sola vez; si no, elegí defaults razonables.
2. **Crear el pack**:
   - variante de uno existente: `pnpm mesa new <id> --from carrera-neural --name "Nombre"`
   - desde cero: `pnpm mesa new <id> --name "Nombre"` (plantilla mínima de 2 facciones y 5 nodos)
3. **Vocabulario y reglas generales** (`rules.json`): `terms` (qué es un nodo, la batalla, el esfuerzo…), `victoryVp`
   (15–25 según duración), mano, `effort.suit`. Ver skill `reglas`.
4. **Mapa**: usá la skill `mapas` (generador `pnpm mesa map generate <id> --nodes N --apply` y después nombres/terrenos a mano).
   Los terrenos del mapa tienen que coincidir con los ids de palos de `cards.json` (si no, sólo los comodines pagan).
5. **Cartas** (`cards.json`): un palo por terreno + opcional un comodín escaso (~10%). Mazo ≈ 10–14 cartas por palo.
6. **Facciones**: con la skill `reglas`. Cada una debe tener setup, al menos una fuente de PV distinta y un `summary`
   que diga exactamente lo que hace la mecánica (`pnpm mesa doc <id>` muestra la traducción del DSL para comparar).
7. **Validar y balancear**: `pnpm mesa validate <id>` → `pnpm mesa sim <id>` → skill `balance` hasta que no haya avisos
   graves. Guardá baseline: `pnpm mesa sim <id> --save baseline`.
8. **Arte**: skill `assets` (`pnpm mesa assets <id>`), revisá visualmente tablero, cartas y fichas.
9. **Cerrar**: `pnpm test` (corre el test de balance de todos los packs) y resumí al usuario: qué se creó, win rates, pendientes.
   Sugerí abrir `pnpm editor` para ajustes finos.

## Reglas de oro

- Todo cambio de datos se valida (`mesa validate`) antes de seguir.
- Nada de recrear juegos comerciales existentes (nombres, arte, textos): diseños originales o del usuario.
- Mantener ids en minúsculas-kebab; el id de cada nodo = su índice.
