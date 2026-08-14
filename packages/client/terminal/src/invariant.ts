/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-terminal`.
 * @module @deepseek-ai/dsh-client-terminal/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-terminal'

/** Cordis companion plugin name. */
export const name = 'client-terminal-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package is the presentation kernel. It emits no
 * cordis events, owns no cross-plugin mutable state, and its ctx.terminal
 * service is re-created per client context and proven disposable by the
 * client-context teardown tests.
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
