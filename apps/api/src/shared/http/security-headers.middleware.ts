import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

/**
 * Security headers on every API response — BUILD_SPEC P14.3.
 *
 * The authoritative set is enforced at the edge by Cloudflare in deployed
 * environments. These exist so a local run, a misconfigured edge, or any path
 * that reaches the origin directly is not bare. The duplication is deliberate
 * defence in depth, the same reasoning as `apps/web/next.config.mjs`.
 *
 * The CSP is `default-src 'none'` because this is a JSON API: it loads
 * nothing, embeds nothing, and is never rendered as a document. A policy
 * copied from a web app would be strictly weaker here for no benefit. It
 * matters despite there being no markup — a browser that is tricked into
 * treating an API response as a document (a sniffed content type, a stray
 * `window.open`) finds a policy that permits nothing.
 *
 * Applied as MIDDLEWARE rather than an interceptor so that error responses
 * carry the headers too. The global exception filter short-circuits
 * interceptors, and an error path that ships bare headers is exactly the path
 * an attacker reaches.
 */
@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");

    // Set here rather than only at the edge: HSTS is ignored over plain HTTP,
    // so a local run is unaffected, while a deployment whose edge config drifts
    // still tells the browser to refuse HTTP for this origin.
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');

    // Express sets this by default. It names the framework and version class,
    // which is free reconnaissance (§6: never leak internals).
    res.removeHeader('X-Powered-By');

    next();
  }
}
