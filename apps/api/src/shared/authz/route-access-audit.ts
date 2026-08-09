import { PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PUBLIC_ENDPOINT_KEY, REQUIRES_ROLE_KEY } from './access-metadata';

export interface UndeclaredRoute {
  controller: string;
  handler: string;
}

/**
 * Finds every registered route handler that declares neither `@RequiresRole`
 * nor `@PublicEndpoint` (BUILD_SPEC P1.5).
 *
 * This runs against Nest's own controller registry rather than against source
 * text. A lint rule reading the AST can be defeated by a route registered
 * dynamically, by a decorator applied through a helper, or simply by a file
 * pattern the rule's glob does not cover. Anything that ends up routable ends
 * up here, which is the only property worth relying on.
 *
 * Class-level declarations count for every handler in the controller; a
 * handler-level declaration overrides the class.
 */
export function findUndeclaredRoutes(app: INestApplication): UndeclaredRoute[] {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const undeclared: UndeclaredRoute[] = [];

  for (const wrapper of discovery.getControllers()) {
    const { instance } = wrapper;
    if (instance === null || instance === undefined) continue;

    const controllerClass = wrapper.metatype;
    if (typeof controllerClass !== 'function') continue;

    const classDeclares =
      Reflect.getMetadata(REQUIRES_ROLE_KEY, controllerClass) !== undefined ||
      Reflect.getMetadata(PUBLIC_ENDPOINT_KEY, controllerClass) !== undefined;

    const prototype = Object.getPrototypeOf(instance) as object;

    for (const methodName of scanner.getAllMethodNames(prototype)) {
      const handler = (prototype as Record<string, unknown>)[methodName];
      if (typeof handler !== 'function') continue;

      // Only actual routes matter. Helper methods on a controller are not
      // reachable over HTTP and must not be forced to declare access.
      const isRoute = Reflect.hasMetadata(PATH_METADATA, handler);
      if (!isRoute) continue;

      const handlerDeclares =
        Reflect.getMetadata(REQUIRES_ROLE_KEY, handler) !== undefined ||
        Reflect.getMetadata(PUBLIC_ENDPOINT_KEY, handler) !== undefined;

      if (!handlerDeclares && !classDeclares) {
        undeclared.push({
          controller: controllerClass.name,
          handler: methodName,
        });
      }
    }
  }

  return undeclared;
}

/**
 * Bootstrap-time gate. Refuses to start the application if any route has no
 * access declaration.
 *
 * Failing at boot rather than at request time is the point: an endpoint with a
 * missing access decision must never accept a single request, not even the one
 * that reveals the mistake.
 */
export function assertAllRoutesDeclareAccess(app: INestApplication): void {
  const undeclared = findUndeclaredRoutes(app);
  if (undeclared.length === 0) return;

  const list = undeclared
    .map((r) => `  - ${r.controller}.${r.handler}()`)
    .join('\n');

  throw new Error(
    `BUILD_SPEC P1.5: ${undeclared.length} route handler(s) declare neither ` +
      `@RequiresRole(...) nor @PublicEndpoint():\n${list}\n\n` +
      'Every endpoint must state its access decision explicitly. If this route ' +
      'is genuinely public, say so with @PublicEndpoint() — do not leave it ' +
      'undeclared.',
  );
}
