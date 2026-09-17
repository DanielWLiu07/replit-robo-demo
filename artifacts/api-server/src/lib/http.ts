import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny, output } from "zod";
import { ZodError } from "zod";
import type { ApiError } from "@workspace/contract";
import { logger } from "./logger";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (m: string) => new HttpError(400, m);
export const notFound = (m = "Not found") => new HttpError(404, m);
export const forbidden = (m = "Not yours") => new HttpError(403, m);

/**
 * The schema gate. Every request body crosses exactly one of these on its way
 * in, and a body that does not satisfy the contract never reaches a service,
 * the database, or the simulation. The 400 it returns names the offending
 * path, because "invalid brain" is useless to somebody building a brain.
 */
export function parseBody<S extends ZodTypeAny>(schema: S, body: unknown): output<S> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  throw new ValidationError(result.error);
}

export class ValidationError extends HttpError {
  constructor(readonly zodError: ZodError) {
    super(400, "Request failed validation");
    this.name = "ValidationError";
  }

  toPayload(): ApiError {
    return {
      error: this.message,
      issues: this.zodError.issues.map((i) => ({
        path: i.path.join(".") || "(root)",
        message: i.message,
      })),
    };
  }
}

/** Errors that carry their own status without extending HttpError (e.g. TrainingBusyError). */
function isStatusError(err: unknown): err is { status: number; message: string } {
  return (
    err instanceof Error &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
  );
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof ValidationError) {
    res.status(err.status).json(err.toPayload());
    return;
  }
  if (isStatusError(err)) {
    res.status(err.status).json({ error: err.message } satisfies ApiError);
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message } satisfies ApiError);
    return;
  }
  if (err instanceof ZodError) {
    // A response failed its own contract — our bug, not the caller's.
    logger.error({ err }, "response failed contract validation");
    res.status(500).json({ error: "Response failed validation" } satisfies ApiError);
    return;
  }
  logger.error({ err }, "unhandled error");
  res.status(500).json({ error: "Internal server error" } satisfies ApiError);
}
