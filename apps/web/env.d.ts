/**
 * Typed public environment variables.
 *
 * WHY THIS FILE EXISTS.
 * `noPropertyAccessFromIndexSignature` rejects `process.env.FOO`, and the rest
 * of this app therefore uses `process.env['FOO']`. That is correct for
 * server-only variables, but NOT for NEXT_PUBLIC_ ones: Next inlines those into
 * the client bundle by textually substituting `process.env.NEXT_PUBLIC_X`, and
 * a bracket access is not substituted — the value would simply be undefined in
 * the browser, silently.
 *
 * Declaring the variable here makes it a real property rather than an index
 * signature hit, so dot access typechecks and the inlining still happens.
 */
declare namespace NodeJS {
  interface ProcessEnv {
    /** 'mock' serves fixtures. Anything else, including unset, means live. */
    readonly NEXT_PUBLIC_MIR_API_MODE?: 'mock' | 'live';
  }
}
