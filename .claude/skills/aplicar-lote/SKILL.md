---
name: aplicar-lote
description: Procesar un lote de cambios preparado en el editor de mesa (packs/<pack>/batches/<lote>.json): aplicar los patches concretos, resolver las intenciones en lenguaje natural respetando sus restricciones, verificar (validación, simulación, assets) y reportar. Usar cuando el usuario pega "/aplicar-lote <ruta>" o pide aplicar/procesar un lote o batch.
argument-hint: packs/<pack>/batches/<lote>.json
---

# Aplicar un lote del editor

Formato del lote: `docs/LOTES.md` (schema: `schemas/batch.schema.json`). Items:
- `patch`: ops ya decididas por el usuario en el editor (`ops` con rutas por id, `from` = valor anterior).
- `intent`: pedido en lenguaje natural (`text`) con `targets` (rutas sugeridas), `constraints` y `verify`
  (`validate`, `sim`, `assets`, `visual`).

## Pasos

1. Leé el lote completo (`$ARGUMENTS` o el que indique el usuario) y `notes`. Si el pack tiene `reports/baseline.json`
   usalo como referencia; si no, corré `pnpm mesa sim <pack> --save pre-lote` antes de tocar nada.
2. **Patches**: `pnpm mesa batch apply <pack> <archivo> --dry` para ver qué pasa; si valida, sin `--dry`
   (marca los items como `applied`). Si alguno falla, explicá por qué (ruta inexistente, conflicto) y no lo fuerces.
3. **Intenciones**, una por una, en orden:
   - Interpretá el pedido usando `targets` como pista y **respetá todas las `constraints`** (ej. "no tocar el mapa").
   - Aplicá el cambio mínimo con `pnpm mesa patch` (o editando JSON) usando las skills `reglas`, `mapas`, `assets`, `balance`.
   - Verificá según `verify`: `validate` siempre; `sim` → `pnpm mesa sim <pack> --vs pre-lote` (o baseline);
     `assets` → `pnpm mesa assets <pack>`; `visual` → rasterizá y mirá los SVG afectados.
   - Si es de balance con objetivo numérico (ej. "Google a ~25%"), iterá con `mesa sweep` hasta llegar dentro de ±3 pts
     con 300+ partidas, o explicá por qué no se puede sin romper una restricción.
   - Actualizá el item en el JSON del lote: `status: "applied"` (o `"rejected"` si no corresponde) y `result` con
     1–3 líneas: qué cambiaste (rutas → valores) y el efecto medido.
4. Al final: `pnpm mesa validate <pack>`, `pnpm test`, y un reporte al usuario: tabla de items (estado + resultado),
   métricas antes/después, y lo que requiere su decisión. No hagas commit salvo que lo pida.

Si una intención es ambigua y las opciones llevan a resultados muy distintos, aplicá las que estén claras y dejá esa
en `pending` con una pregunta concreta en `result`.
