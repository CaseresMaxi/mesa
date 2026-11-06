# mesa — motor de juegos de mesa

Motor para diseñar juegos de mesa de **control de área asimétrico** describiéndolos con datos: mapa, cartas, reglas y
facciones viven en JSON validado; el motor los juega, los bots los simulan para medir el balance, el arte se genera
dibujado a mano, y un editor local permite ajustar todo fino o preparar **lotes de cambios para la IA**.

Nació de generalizar *Carrera Neural* (`../root-3d`): el pack `packs/carrera-neural` reproduce ese juego **partida por
partida** (test de paridad sobre 300 partidas de bots contra el motor original).

## Uso rápido

```bash
pnpm install
pnpm dev                             # editor http://localhost:5180 + juego http://localhost:5181
pnpm build:games                     # sitio estático jugable por pack en packages/play/dist/
pnpm mesa validate carrera-neural    # esquema + coherencia
pnpm mesa sim carrera-neural         # 300 partidas de bots → win rates, asientos, fuentes de PV
pnpm mesa sweep carrera-neural --path /factions/google/warriors/count --values 16,18,20
pnpm mesa map analyze carrera-neural
pnpm mesa assets carrera-neural      # SVGs en packs/carrera-neural/assets/generated
pnpm mesa fx carrera-neural          # animaciones de pelea: clips, línea de tiempo y ritmo
pnpm mesa doc carrera-neural         # reglas legibles generadas desde los datos
pnpm mesa new mi-juego --from carrera-neural
pnpm test && pnpm typecheck
```

`pnpm mesa` sin argumentos lista todos los comandos.

## Con Claude Code (skills)

En `.claude/skills/`:

| Skill | Para qué |
|---|---|
| `nuevo-juego` | arrancar un juego/variante desde una idea, otro pack o la plantilla |
| `mapas` | generar, analizar y corregir mapas (simetría de esquinas, terrenos, cuellos de botella) |
| `assets` | arte: recetas, librería de dibujos, overrides en el manifest, dibujos nuevos |
| `animaciones` | animaciones de pelea: clips con efectos (embestida, proyectiles, dados, bajas…), clip por facción |
| `reglas` | facciones y reglas con el DSL; extender el DSL cuando no alcanza |
| `balance` | simulaciones, barridos, baseline, diagnóstico por fuentes de PV y por asiento |
| `aplicar-lote` | procesar un lote del editor: patches + intenciones en lenguaje natural, verificar y reportar |
| `probar-web` | levantar el entorno, jugar/automatizar partidas en el navegador, P2P, build y deploy |

Flujo típico: ajustás en el editor → *Lote IA* → guardás el lote con tus patches y pedidos ("bajá a DeepSeek a ~25%
sin tocar el mapa") → en Claude Code: `/aplicar-lote packs/carrera-neural/batches/<lote>.json`.

## Entorno web de desarrollo

- **Juego** (`packages/play`): juega cualquier pack sin código propio — la UI de acciones se arma desde
  `engine.legalMoves` y el tablero usa el arte generado del pack. Partida local (hotseat + bots) u **online P2P**
  (WebRTC vía Trystero, host autoritativo: el host le manda el pack y a cada uno su vista sin información oculta).
- **Ciclo en vivo**: editás en el editor → **▶ Probar** publica el borrador → el juego se recarga y **re-juega la
  partida en curso** con la misma semilla (o te dice en qué move se rompió). También reacciona a cambios en disco
  (por ejemplo, cuando Claude aplica un lote).
- **Panel Dev** (tecla `` ` ``): ver todo, bots (pausa/paso/velocidad), moves legales clickeables, historial con slider,
  estado JSON, saves reproducibles (semilla + historial), avisos del pack.
- URLs útiles: `?pack=<id>&draft=1`, `&auto` (partida directa), `&auto=bots`, `&room=CODIGO`.
- **Deploy**: `pnpm build:games` → un sitio estático por pack; `.github/workflows/deploy.yml` lo publica en GitHub Pages.

## Estructura

```text
packages/
  core/     esquema zod (fuente de verdad) · motor genérico · DSL · validación · rutas por id/patches/diff
            · lotes · simulación de balance · generador y análisis de mapas · @mesa/core/node (fs)
  art/      assets SVG dibujados a mano (rough.js + acuarela), recetas + librería de dibujos de root-3d
  fx/       animaciones de pelea: runtime puro (frameAt) + componente React BattleFx
  cli/      `pnpm mesa …`
  editor/   Vite + React: mapa, facciones, cartas/reglas, assets, animaciones, balance, lotes IA, JSON/diff, ▶ Probar
  play/     cliente web genérico: tablero, acciones desde legalMoves, bots, P2P, hot-reload, panel Dev, build por pack
  devserver/ API local /api (packs, borradores, lotes, reportes, archivos) + eventos en vivo (SSE)
packs/<id>/ pack.json · rules.json · map.json · cards.json · factions.json · assets/manifest.json · animations.json
            · batches/ (lotes) · reports/ (simulaciones guardadas, ej. baseline.json)
schemas/    JSON Schema de cada archivo (pnpm mesa schema)
docs/       DSL.md (formato y DSL de reglas) · LOTES.md (formato de lotes)
```

## Qué soporta el motor

- Turno inicio → acciones → cierre; gobernar nodos por presencia; cartas que pagan por terreno (+ comodines).
- Moves: mover, reclutar, construir (pista de PV), fichas, especial 1/turno, batalla con d6, esfuerzo, descarte.
- Arquetipos `standard` y `nomad` (peón único con inventario de componentes).
- Habilidades declarativas: condiciones sobre nodos, expresiones (conteos, tablas, divisiones, vars),
  efectos (colocar guerreros, PV, robar, convertir guerreros…), reglas de puntuación de cierre con texto.
- Estado JSON serializable y determinista (PRNG semillado), vista por jugador sin info oculta, `legalMoves`.

Todavía no: render 3D (el diorama de root-3d sigue con su motor propio; portarlo como vista alternativa de
`@mesa/play` es el próximo paso), facciones con varios peones nómades, cartas con efectos propios.

> Carrera Neural es una parodia de fans sin fines de lucro; los nombres de empresas son marcas de sus dueños
> y el arte son caricaturas originales sin logos oficiales.
