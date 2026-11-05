import type { GamePackInput, SimOptions, SimReport } from '@mesa/core';

/** Lanza una simulación en un worker nuevo (así se pueden correr varias en paralelo). */
export function runSim(input: GamePackInput, opts: SimOptions): { promise: Promise<SimReport>; cancel: () => void } {
  const w = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
  let reject!: (e: Error) => void;
  const promise = new Promise<SimReport>((res, rej) => {
    reject = rej;
    w.onmessage = (e: MessageEvent<{ ok: boolean; report?: SimReport; error?: string }>) => {
      w.terminate();
      if (e.data.ok) res(e.data.report!);
      else rej(new Error(e.data.error));
    };
    w.onerror = (e) => {
      w.terminate();
      rej(new Error(e.message || 'Error en el worker'));
    };
  });
  w.postMessage({ input: JSON.parse(JSON.stringify(input)), opts });
  return {
    promise,
    cancel: () => {
      w.terminate();
      reject(new Error('cancelado'));
    },
  };
}
