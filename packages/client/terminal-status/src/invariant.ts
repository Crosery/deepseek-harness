/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-terminal-status`.
 * @module @deepseek-ai/dsh-client-terminal-status/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-terminal-status'

/** Cordis companion plugin name. */
export const name = 'client-terminal-status-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package is a pure presentation projection. It
 * emits no cordis events and owns no cross-plugin mutable state; its kernel
 * registrations unwind with the plugin fiber.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
