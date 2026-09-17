import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { logger } from "./logger";

/**
 * Resolve a forked worker in both worlds: under tsx this module *is*
 * `src/lib/forkJob.ts`, and in production it has been bundled into
 * `dist/index.mjs`, so `import.meta.url` points somewhere else entirely.
 * esbuild roots the multi-entry output at `src/`, which makes the two layouts
 * line up: `src/verify/worker.ts` <-> `dist/verify/worker.mjs`.
 */
export function workerPath(name: string): string {
  const here = import.meta.url;
  return fileURLToPath(
    here.endsWith(".mjs")
      ? new URL(`./${name}/worker.mjs`, here) // dist/index.mjs -> dist/<name>/worker.mjs
      : new URL(`../${name}/worker.ts`, here), // src/lib/ -> src/<name>/
  );
}

/**
 * Run a CPU-bound job in a child process and resolve with its single result.
 *
 * Inheriting `execArgv` is what makes one code path work in dev and prod: under
 * tsx it carries the TypeScript loader flags the child needs, and in the
 * container it is just --enable-source-maps.
 */
export function forkJob<T>(
  name: string,
  payload: unknown,
  opts: { timeoutMs: number },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const child = fork(workerPath(name), [JSON.stringify(payload)], {
      execArgv: process.execArgv,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      logger.error({ worker: name }, "forked job timed out, killing");
      child.kill("SIGKILL");
      finish(() => reject(new Error(`${name} worker timed out`)));
    }, opts.timeoutMs);

    child.on("message", (msg) => {
      const m = msg as { ok?: T; error?: string };
      if (m?.error) finish(() => reject(new Error(m.error)));
      else if (m && "ok" in m) finish(() => resolve(m.ok as T));
    });
    child.on("error", (err) => finish(() => reject(err)));
    child.on("exit", (code, signal) =>
      finish(() =>
        reject(new Error(`${name} worker exited without a result (code ${code}, signal ${signal})`)),
      ),
    );
  });
}
