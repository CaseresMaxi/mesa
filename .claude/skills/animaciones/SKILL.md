---
name: animaciones
description: Crear o ajustar las animaciones de las peleas (batallas) de un pack del motor mesa, como embestidas, proyectiles, dados, explosiones, bajas y textos, y elegir qué clip usa cada facción. Usar cuando piden animar peleas, darle personalidad visual a una facción al atacar, que las batallas "se sientan" mejor, o que sean más cortas o más rápidas.
---

# Animaciones de pelea

Las peleas se animan desde **datos**: `packs/<id>/animations.json` (opcional; si falta se usa el clip
incorporado `clasico`). El motor registra cada pelea en `state.lastBattle` (tiradas, impactos, guerreros
al empezar y bajas de cada bando) y el cliente reproduce el clip encima del nodo, con zoom. Los bots
esperan a que termine. El runtime es `@mesa/fx` (`frameAt(ctx, t)` es puro y determinista: cada instante
se puede muestrear).

## Formato

```json
{
  "$schema": "../../schemas/animations.schema.json",
  "enabled": true,
  "speed": 1,
  "clips": {
    "laser": {
      "description": "Disparo concentrado",
      "steps": [
        { "fx": "dice", "at": 0, "dur": 800 },
        { "fx": "projectile", "at": 200, "dur": 600, "from": "attacker", "shape": "bolt", "count": 4 },
        { "fx": "shake", "at": 700, "dur": 300, "who": "defender", "when": "defenderLost" },
        { "fx": "casualties", "at": 1000, "dur": 900 },
        { "fx": "text", "at": 1000, "dur": 900, "text": "{ah} – {dh}" }
      ]
    }
  },
  "battle": { "default": "laser", "byAttacker": { "redditor": "emboscada" } }
}
```

Cada paso tiene `at` y `dur` en ms, `when` y `ease` (`linear`, `in`, `out`, `inOut`, `back` o `bounce`).

**`when`** depende del resultado de la pelea:

- `always`
- `attackerWins` / `defenderWins` / `draw`: comparan las bajas de cada bando.
- `undefended`: el defensor no tenía guerreros.
- `attackerLost` / `defenderLost`: ese bando perdió algo.
- `noLosses`: nadie perdió nada.

**Efectos (`fx`):**

| fx | qué hace | parámetros |
|---|---|---|
| `lunge` | las figuras de un bando se lanzan hacia el rival y vuelven | `who` (attacker/defender), `dist` |
| `shake` | temblor | `who` (attacker/defender/node), `amp` |
| `flash` | destello de color sobre las figuras | `who`, `color` |
| `projectile` | proyectiles en arco de un bando al otro | `from`, `shape` (orb/bolt/arrow/star) **o** `asset` (id de un asset del pack, p. ej. `token-google`), `color`, `count`, `size`, `arc` |
| `burst` | explosión de partículas | `who`, `color`, `count`, `radius` |
| `ring` | onda expansiva | `who`, `color`, `radius` |
| `dice` | los dados ruedan y caen en las tiradas reales; los impactos se resaltan con el color del bando. Quedan visibles hasta el final | `size` |
| `casualties` | las bajas caen y se desvanecen, y flota un "-N" | — |
| `text` | texto con "pop" | `text`, `who`, `color`, `size` |

- **Colores:** `#rrggbb`, o `"attacker"` / `"defender"` para usar el color de esa facción.
- **Variables de `text`:** `{attacker}`, `{defender}`, `{node}`, `{ah}` y `{dh}` (impactos), `{aLoss}` y `{dLoss}` (bajas).
- **Clips incorporados:** `clasico`, `disparo` y `emboscada` (en `packages/core/src/fx.ts`). Un clip del pack con el mismo nombre los pisa.

## Flujo

1. **Mirar lo que hay:** `pnpm mesa fx <pack>`. Muestra el clip de cada facción y la línea de tiempo ASCII de cada clip (`░` = no corre con ese resultado). También informa el **ritmo**: cuántas peleas hay por partida y cuántos segundos de animación suman.
   - Con `--clip x --outcome pierde|gana|empate|sin-defensa` se ve un clip y un resultado puntuales.
2. **Editar `animations.json`.** Escribí a mano o usá `pnpm mesa patch <pack> '[{"op":"add","path":"/animations/clips/x","value":{...}}]'`. Siempre tiene que quedar un paso `casualties`: si no, las bajas desaparecen de golpe (el validador avisa).
3. **Validar:** `pnpm mesa validate <pack>`. Revisa los clips y las facciones referenciados, la duración (más de 6 s es un aviso) y que haya `casualties`.
4. **Verlo**, que es obligatorio para dar por buena una animación:
   - **Editor**, pestaña 🎬 Animaciones: vista previa con elección de atacante, defensor y resultado, scrub y línea de tiempo.
   - **Juego:** `http://localhost:5181/?pack=<id>&auto=bots`. Para capturar varios frames de una pelea real, seguí la skill `probar-web`: esperá a que cambie `__mesa.session.getState().view.lastBattle` y sacá capturas cada ~300 ms.
   - En el panel Dev (tecla `` ` ``) hay "animar peleas" y velocidad.

## Criterios

- **Duración:** entre 1,2 y 2,5 s por pelea. Multiplicalo por las peleas por partida que informa `mesa fx`: más de ~40 s de animación por partida cansa. Para acortar, bajá `speed` antes que quitar pasos.
- **Lectura:** dados → impacto → bajas → resultado. Los dados tienen que estar antes de `casualties`.
- **Personalidad por facción:** el atacante define el clip (`byAttacker`). Usá su color (`"attacker"`), sus assets (`asset: "token-<f>"`) y textos con su tono.
- **`when`:** usalo para que el clip cuente lo que pasó. Si el atacante pierde, mostrá el contraataque: `projectile` con `from: defender` y `when: attackerLost`.
- **Código:** un efecto nuevo es un caso más en `FxStep` (`packages/core/src/schema.ts`), en `frameAt` (`packages/fx/src/timeline.ts`) y en `SpriteEl` (`BattleFx.tsx`). Agregá un test en `packages/fx/test` y regenerá los esquemas con `pnpm mesa schema`.
