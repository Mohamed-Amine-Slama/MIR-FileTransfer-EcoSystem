import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { runWithContextScope } from './request-context';

/**
 * Opens the AsyncLocalStorage scope for a request.
 *
 * Must be applied to every route ('*'), before guards run. Middleware is the
 * only layer that wraps the entire downstream chain — guards, interceptors and
 * the handler all execute inside `next()`, so a scope opened here is visible
 * to all of them. The auth guard fills the identity in once the token is
 * verified.
 *
 * Applying this to only some routes would leave the rest with no scope, and
 * `setContext` would throw at request time rather than at boot. The
 * corresponding test asserts the scope exists for an unauthenticated route
 * too.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(_req: Request, _res: Response, next: NextFunction): void {
    runWithContextScope(() => {
      next();
    });
  }
}
