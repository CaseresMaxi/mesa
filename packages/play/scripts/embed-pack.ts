import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { parsePack, type AssetEntry } from '@mesa/core';
import { loadPackInput, packDir } from '@mesa/core/node';

/** Build: emite `pack.json` (validado) y los archivos propios del manifest en `files/`. */
export function embedPack(id: string): Plugin {
  return {
    name: 'mesa-embed-pack',
    apply: 'build',
    generateBundle() {
      const dir = packDir(id);
      const input = loadPackInput(dir);
      parsePack(input); // falla el build si el pack tiene errores
      this.emitFile({ type: 'asset', fileName: 'pack.json', source: JSON.stringify(input) });
      for (const e of ((input.assets as { entries?: AssetEntry[] } | undefined)?.entries ?? []))
        if (e.file) this.emitFile({ type: 'asset', fileName: `files/${e.file}`, source: readFileSync(join(dir, e.file)) });
    },
  };
}
