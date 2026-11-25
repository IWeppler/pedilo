import type { FastifyBaseLogger } from "fastify";

/**
 * Corre `run` cada `intervalMs` dentro del proceso de la API, sin ejecuciones superpuestas.
 * `run` devuelve cuántos elementos procesó: si procesó algo, vuelve a correr enseguida hasta
 * vaciar lo pendiente. Los errores se registran y se reintenta en el próximo ciclo.
 * Durable siempre que el estado viva en la base (ADR 0008).
 */
export function startIntervalWorker(opts: {
  name: string;
  intervalMs: number;
  log: FastifyBaseLogger;
  run: () => Promise<number>;
}): { stop: () => Promise<void> } {
  const { name, intervalMs, log, run } = opts;
  if (intervalMs <= 0) {
    log.info({ worker: name }, "worker desactivado");
    return { stop: async () => {} };
  }

  let running: Promise<void> | null = null;
  let stopped = false;

  const sweep = async () => {
    try {
      let total = 0;
      for (let n = await run(); n > 0 && !stopped; n = await run()) total += n;
      if (total > 0) log.info({ worker: name, processed: total }, "worker procesó elementos");
    } catch (err) {
      log.error({ err, worker: name }, "falló el worker; se reintenta en el próximo ciclo");
    }
  };

  const tick = () => {
    if (stopped || running) return;
    running = sweep().finally(() => {
      running = null;
    });
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
