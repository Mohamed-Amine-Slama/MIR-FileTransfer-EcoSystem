#!/usr/bin/env node
/**
 * BUILD_SPEC P8.2, third verification:
 * "Frontend contains no Orthanc credentials (grep the bundle)."
 *
 * The gate this supports is: "No path exists from the browser to Orthanc that
 * bypasses the API." Credentials in the bundle would BE such a path — every
 * user would hold them, and Orthanc's own authentication would then be the
 * only thing between a curious doctor and every patient's imaging, with no
 * audit row written for anything they did.
 *
 * Broader than Orthanc: this fails on any server-only configuration value that
 * reached client JavaScript. In Next.js the usual cause is referencing
 * `process.env.SOMETHING` in a component — the value is inlined at build time
 * and shipped, silently, to every browser.
 *
 * Run: node scripts/check-bundle-secrets.mjs   (wired into `pnpm verify` and CI)
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE_DIRS = [
  join(REPO, 'apps/web/.next/static'),
  join(REPO, 'apps/web/.next/server'),
];

/**
 * Names of variables that must never appear in client output.
 *
 * Matching on the NAME as well as any value catches the case where the value
 * is currently a harmless placeholder but the wiring is already wrong — which
 * is the moment to fix it, not after a real credential is deployed.
 */
const FORBIDDEN_NAMES = [
  'ORTHANC_PASSWORD',
  'ORTHANC_USERNAME',
  'ORTHANC_URL',
  'DATABASE_URL',
  'SIGNED_URL_SECRET',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'KEYCLOAK_CLIENT_SECRET',
];

/** Value shapes that are always a leak, whatever they are called. */
const FORBIDDEN_PATTERNS = [
  { name: 'postgres connection string', re: /postgres(?:ql)?:\/\/[^\s"'`]+:[^\s"'`@]+@/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Stripe secret key', re: /\bsk_(?:live|test)_[0-9a-zA-Z]{16,}/ },
  { name: 'Stripe webhook secret', re: /\bwhsec_[0-9a-zA-Z]{16,}/ },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

/**
 * Client-visible env vars are allowed by design in Next.js. Flagging
 * NEXT_PUBLIC_* would be wrong — the prefix is the explicit declaration that a
 * value is public.
 */
const ALLOWED = /NEXT_PUBLIC_/;

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const SCANNABLE = /\.(js|mjs|cjs|json|map|html|css|txt)$/;

const violations = [];
let scanned = 0;

for (const dir of BUNDLE_DIRS) {
  for (const path of walk(dir)) {
    if (!SCANNABLE.test(path)) continue;
    scanned++;

    const content = readFileSync(path, 'utf8');
    const rel = relative(REPO, path);

    for (const name of FORBIDDEN_NAMES) {
      let index = content.indexOf(name);
      while (index !== -1) {
        const window = content.slice(Math.max(0, index - 40), index + name.length + 40);
        if (!ALLOWED.test(window)) {
          violations.push({ file: rel, finding: `server-only variable "${name}"`, window });
          break;
        }
        index = content.indexOf(name, index + 1);
      }
    }

    for (const { name, re } of FORBIDDEN_PATTERNS) {
      if (re.test(content)) {
        violations.push({ file: rel, finding: name, window: '(value redacted)' });
      }
    }
  }
}

if (scanned === 0) {
  console.error('FAIL: no bundle files were scanned.');
  console.error('Build the web app first:  pnpm --filter @mir/web build');
  console.error('A check that inspects nothing reports success forever.');
  process.exit(1);
}

if (violations.length > 0) {
  console.error(`FAIL: ${violations.length} secret(s) found in the client bundle.\n`);
  console.error('BUILD_SPEC P8.2: the frontend must contain no Orthanc credentials, and');
  console.error('no path may exist from the browser to Orthanc that bypasses the API.\n');
  for (const v of violations) {
    console.error(`  ${v.file}`);
    console.error(`    ${v.finding}`);
    console.error(`    context: ${v.window.replace(/\s+/g, ' ').slice(0, 120)}`);
  }
  console.error(
    '\nUsual cause: referencing process.env.X in a client component. Next.js inlines\n' +
      'that value at build time and ships it to every browser. Move the access to a\n' +
      'server component or a route handler, or rename it NEXT_PUBLIC_* if it is\n' +
      'genuinely public.',
  );
  process.exit(1);
}

console.log(`OK: ${scanned} bundle files scanned, no server-only secrets present.`);
