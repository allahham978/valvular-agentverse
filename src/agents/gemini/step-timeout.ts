import type { ModelClient, ModelRequest, ModelTurn } from "../model-client/types";

const TIMED_OUT = Symbol("timed out");

export function withStepTimeout(client: ModelClient, { timeoutMs, retries }: { timeoutMs: number; retries: number }): ModelClient {
  async function attempt(request: ModelRequest): Promise<ModelTurn | typeof TIMED_OUT> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (request.signal.aborted) abort();
    request.signal.addEventListener("abort", abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
    });
    const work = client.nextTurn({ ...request, signal: controller.signal });
    work.catch(() => undefined);
    try {
      const result = await Promise.race([work, timedOut]);
      if (result === TIMED_OUT) controller.abort();
      return result;
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
    }
  }

  return {
    mode: client.mode,
    async nextTurn(request) {
      for (let tries = 0; tries <= retries; tries++) {
        const result = await attempt(request);
        if (result !== TIMED_OUT) return result;
      }
      throw new Error(`Model step timed out after ${timeoutMs / 1000} s, then again on its one retry.`);
    },
  };
}
