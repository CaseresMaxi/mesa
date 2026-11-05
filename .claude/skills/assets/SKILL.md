---
name: assets
description: Generar, ajustar o agregar assets visuales (tablero, cartas, dorso, guerreros, edificios, fichas, componentes, dados, íconos, cartas de facción) de un pack del motor mesa, con estilo dibujado a mano. Usar cuando piden arte nuevo, cambiar colores/estilo, ilustrar una facción o reemplazar un asset por un archivo propio.
---

# Assets

El arte es SVG generado por código (`packages/art`, rough.js + filtros de acuarela + grano de papel), determinista.
`collectAssets(pack)` arma la lista automática a partir del pack y le aplica el **manifest**
(`packs/<id>/assets/manifest.json`): una entrada con la misma `id` pisa `params`, `recipe` o `file`.

## Comandos

- `pnpm mesa assets <pack>` → escribe todo en `packs/<pack>/assets/generated/` (salida, está en .gitignore).
- `pnpm mesa assets <pack> --only board,card-back,warrior-google`.
- Para MIRAR un asset: `rsvg-convert <svg> -w 600 -o <scratchpad>/x.png` y leé el PNG (podés juntar varios con
  `magick a.png b.png -resize x400 +append fila.png`). Revisá siempre visualmente antes de dar por bueno.
- En el editor (`pnpm editor`, pestaña Assets) se ven todos en grilla con fuentes Caveat/Patrick Hand.

## Recetas (`RECIPES` en packages/art/src/index.ts)

`board`, `card {name, suit, vignette?}`, `card-back {title?, color?}`, `suit-icon {suit}`, `die {value, color}`,
`warrior {faction, drawer?}`, `building {faction, kind?, drawer?}`, `token {faction, kind?, drawer?}`,
`item {faction, item}`, `faction-card {faction, drawer?}`, `library {drawer, color?}`.
Ids automáticos: `board`, `suit-<id>`, `card-<slug-del-nombre>`, `card-back`, `faction-card-<f>`, `warrior-<f>`,
`building-<f>`, `token-<f>`, `item-<f>-<item>`, `die-<1..6>`.

**Librería** (`LIBRARY`): dibujos con nombre reutilizables — `character:<google|meta|anthropic|openai|deepseek|redditor>`,
`datacenter`, `repo`, `laboratorio`, `cluster`, `demo`, `item:<cafe|gpu|dataset|teclado>`, `vignette:<nombre de carta>`.
Los edificios/fichas usan automáticamente el dibujo de librería cuyo nombre coincide con `building.kind`/`token.kind`;
las cartas usan `vignette:<nombre>` si existe; si no, un ícono grande del palo.

## Tareas típicas

- **Override por manifest** (sin código): `{"id":"warrior-meta","category":"Guerreros","recipe":"warrior","params":{"drawer":"character:meta"}}`.
- **Archivo propio**: copiá el SVG/PNG a `packs/<id>/assets/` y agregá `{"id":"board","category":"Tablero","recipe":"board","file":"assets/mi-tablero.png"}`.
- **Estilo global**: `/assets/style` (`roughness` 0–4, `ink`, `paper`).
- **Dibujo nuevo** (personaje, edificio, viñeta): agregá una función en `packages/art/src/library/*.ts` usando la API de
  `Pen` (`rect`, `circle`, `ellipse`, `path`, `poly`, `line`, `curve`, `text`, `wash`, `washEllipse`, `g`;
  estilos `fill`, `stroke`, `sw`, `hachure`, `gap`, `rough`, `single`, `flat`), registrala en `LIBRARY` y referenciala
  desde el manifest. Lienzos: personajes 240×300 (pies en y≈292), edificios/fichas 256×256, componentes 128×128,
  viñetas de carta centradas en (100,130) ~150×110. Mantené la paleta del pack y el trazo de tinta.
- Después: `pnpm typecheck` si tocaste código, regenerá y mirá el resultado.

Nada de logos oficiales ni arte copiado de juegos existentes: caricaturas y diseños originales.
