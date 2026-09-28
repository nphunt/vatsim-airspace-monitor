import type { ErrorRequestHandler, RequestHandler } from "express";

/** Thrown from route handlers; becomes `{ error }` with this status. */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, "not found"));
};

/** Last middleware. Express 5 routes async rejections here too. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500 && !(err instanceof HttpError)) console.error(err);
  res
    .status(status)
    .json({ error: status >= 500 && !(err instanceof HttpError) ? "internal error" : err.message });
};
