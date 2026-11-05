/// <reference lib="webworker" />
import { parsePack, simulate, type GamePackInput, type SimOptions } from '@mesa/core';

/** Corre simulaciones de balance fuera del hilo de la UI. */
self.onmessage = (e: MessageEvent<{ input: GamePackInput; opts: SimOptions }>) => {
  try {
    const report = simulate(parsePack(e.data.input), e.data.opts);
    self.postMessage({ ok: true, report });
  } catch (err) {
    self.postMessage({ ok: false, error: (err as Error).message });
  }
};
