# Lotes (batches): del editor a la IA

Un **lote** es un archivo `packs/<pack>/batches/<nombre>.json` con cambios preparados para aplicar juntos.
Sirve para dos cosas:

1. **Ajustes finos decididos por vos** (items `patch`): tocás valores en el editor en modo *Lote* y el diff contra
   lo que está en disco se convierte en operaciones con rutas por id. Se pueden revisar, reordenar, borrar ops y
   aplicar después (en el editor, con `pnpm mesa batch apply`, o pidiéndole a Claude).
2. **Pedidos para la IA** (items `intent`): describís en lenguaje natural lo que querés, con rutas objetivo,
   restricciones y cómo verificar. Claude los resuelve con la skill `aplicar-lote`.

```json
{
  "$schema": "../../../schemas/batch.schema.json",
  "format": "mesa-batch",
  "version": 1,
  "pack": "carrera-neural",
  "title": "Ronda de balance 1",
  "createdAt": "2026-11-05T15:00:00.000Z",
  "notes": "Priorizar cambios chicos. No tocar el mapa.",
  "items": [
    {
      "id": "patch-1",
      "kind": "patch",
      "title": "Ajustes en /factions/google",
      "ops": [{ "op": "replace", "path": "/factions/google/warriors/count", "from": 20, "value": 18 }],
      "status": "pending"
    },
    {
      "id": "intent-1",
      "kind": "intent",
      "title": "DeepSeek gana demasiado",
      "text": "DeepSeek gana ~32%. Bajala a ~25% tocando su puntuación de cierre, no su economía.",
      "targets": ["/factions/deepseek/onClose"],
      "constraints": ["No tocar el mapa", "Máximo 2 cambios"],
      "verify": ["validate", "sim"],
      "status": "pending"
    }
  ]
}
```

- `ops`: `replace` / `add` / `remove` con rutas por id (`/factions/<id>/…`, `/map/nodes/<n>/…`; `-` = agregar al final).
- `status`: `pending` → `applied` | `rejected`. Quien procesa el lote escribe `result` en las intenciones.
- Aplicar sólo los patches: `pnpm mesa batch apply <pack> <nombre>` (valida antes de escribir; `--dry` para probar).
- Con Claude: `/aplicar-lote packs/<pack>/batches/<nombre>.json`.
