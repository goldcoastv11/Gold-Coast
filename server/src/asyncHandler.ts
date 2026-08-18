import { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 does not automatically catch a rejected promise from an async
 * route handler - an unhandled rejection there would otherwise hang the
 * request instead of reaching app.ts's error-handling middleware. Wrap
 * every async route handler with this so a thrown/rejected error is
 * forwarded via `next(err)`.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
