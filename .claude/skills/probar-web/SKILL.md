---
name: probar-web
description: Levantar el entorno web de desarrollo de mesa (editor + cliente de juego), jugar o automatizar partidas de un pack en el navegador, verificar cambios en vivo (hot-reload con replay), probar online P2P y generar/deployar el build estático. Usar cuando piden "probalo en el navegador", "jugá una partida", "fijate cómo se ve", "deployá el juego", o para verificar visualmente cambios de reglas, mapa o arte.
---

# Probar en la web

## Entorno

- `pnpm dev` → **editor** http://localhost:5180 + **juego** http://localhost:5181 (ambos con la API local `/api`,
  paquete `@mesa/devserver`). Por separado: `pnpm editor` / `pnpm play`. Correlo en background y al terminar matá
  **sólo esos procesos por PID** (no uses `pkill -f vite`: puede haber otros proyectos corriendo).
- El juego (`packages/play`) juega **cualquier pack** sin código propio: las acciones salen de `engine.legalMoves`.
- URL: `?pack=<id>` · `&draft=1` (usa el borrador publicado por el editor) · `&auto` (partida local directa: asiento 1
  humano, resto bots) · `&auto=bots` (todos bots) · `&room=CODIGO` (unirse online).
- **Hot-reload**: al cambiar archivos del pack (o el borrador `packs/<id>/.draft.json`) el juego recarga el pack y
  **re-juega el historial** con la misma semilla; un toast dice cuántos moves se re-jugaron o en cuál se cortó.
- Editor → **▶ Probar**: publica el borrador y abre el juego; mientras está "en vivo" cada edición se refleja.
  **■** deja de sincronizar y borra el borrador.
- Panel 🛠 **Dev** (tecla `` ` ``): ver todo (manos/mazo), pausar bots / paso / demora, reiniciar con la misma semilla,
  save/carga (`.mesa-save.json` = semilla + asientos + historial), moves legales clickeables, historial con slider,
  estado JSON, avisos del pack.

## Automatizar desde Claude

- `window.__mesa.session` es el store (zustand): `getState()` → `view`, `full`, `history`, `seats`, `engine`…;
  acciones `startLocal()`, `setSeats()`, `startGame()`, `send(move)`, `undo()`, `restart()`, `stepBot()`, `set({godView})`.
  `window.__mesa.authority()` da la autoridad (estado completo).
- MCP chrome-devtools: `new_page` → `evaluate_script` / `take_screenshot`. Si no arranca porque su perfil está en uso,
  levantá un Chrome propio:
  `google-chrome-stable --headless=new --remote-debugging-port=9333 --user-data-dir=<scratchpad>/chrome --window-size=1500,950 <url>`
  y manejalo por CDP (`/json`, `/json/new?<url>`, `Runtime.evaluate`, `Page.captureScreenshot`); leé las capturas.
- P2P en una máquina: dos pestañas con distinto `localStorage['mesa.playerId']` (si no, son el mismo jugador).
  La señalización usa relays públicos (Trystero/Nostr): necesita internet; sin TURN, redes corporativas pueden fallar.

## Qué verificar después de un cambio

1. El pack valida y el juego carga sin toast de error (`pnpm mesa validate <id>`).
2. Una partida `&auto=bots` termina (hay ganador) y el log tiene textos coherentes.
3. Lo que cambiaste se ve: captura del tablero / mano / panel de facción.
4. Si cambiaste reglas con una partida en curso, el replay no corta (o corta donde esperabas).

## Build y deploy

- `pnpm build:games [pack…]` → `packages/play/dist/<pack>/` (sitio estático con `pack.json` empaquetado; falla si el
  pack tiene errores) + `dist/index.html` con la lista. Probar: `python3 -m http.server -d packages/play/dist 5190`.
- GitHub Pages: `.github/workflows/deploy.yml` (push a main) publica todos los packs.
