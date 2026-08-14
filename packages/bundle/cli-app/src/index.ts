/**
 * @deepseek-ai/dsh-cli-app — the terminal surface runner. It composes the
 * host gateway into one pure fetch handler, boots a Node-resident client
 * cordis context (the terminal plane) over it with zero sockets, and owns
 * the session lifecycle for both interactive and one-shot print runs.
 *
 * @module @deepseek-ai/dsh-cli-app
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import type { SessionRuntime } from '@deepseek-ai/dsh-client-runtime/client-node'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from './startup.ts'

/** Stable Cordis plugin name. */
export const name = 'cli-app'

/** Core services required before the terminal plane can boot. */
export const inject = ['loader', 'apiProxy', 'cliStartup']

/**
 * Structural slice of the host connection service (the client-connection
 * node half): composing the gateway handler with the logical RPC channels.
 * Declared locally so the bundle never type-imports the split client leaf.
 */
interface HostConnectionLike {
  /**
   * Compose the shared-channel handler from the gateway fallback.
   * @param channel - the shared channel path.
   * @param fallback - the gateway fetch handler.
   * @returns the composed handler.
   */
  createSharedFetchHandler(channel: string, fallback: { fetch: typeof fetch }): { fetch: typeof fetch }
}

/** One dsh.client declaration, read from a candidate package manifest. */
interface ClientDeclaration {
  platform?: string
  platforms?: string[]
}

/**
 * Read the client platform list of one package manifest.
 * @param pkgPath - absolute package.json path.
 * @returns the declared platforms, or undefined when the package is not a client package.
 */
function readClientPlatforms(pkgPath: string): string[] | undefined {
  const manifest = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    dsh?: { client?: ClientDeclaration }
  }
  const decl = manifest.dsh?.client
  if (decl === undefined) return undefined
  return decl.platforms ?? (decl.platform !== undefined ? [decl.platform] : undefined)
}

/**
 * Scan the composed loader entries for packages whose client half serves the
 * terminal platform (the cli profile's own rows plus any user-patched
 * additions — the same patchable composition the web roster gets).
 * @param loader - the host loader.
 * @param require - resolution anchored at the profile directory.
 * @returns the terminal roster, in entry order without duplicates.
 */
function scanTerminalRoster(loader: { entries(): Iterable<{ options: { name: string } }> }, require: NodeJS.Require): string[] {
  const roster: string[] = []
  const seen = new Set<string>()
  for (const entry of loader.entries()) {
    const name = entry.options.name
    if (name.startsWith('.') || seen.has(name)) continue
    seen.add(name)
    let platforms: string[] | undefined
    try {
      platforms = readClientPlatforms(require.resolve(name + '/package.json'))
    } catch {
      // Not a resolvable package (subpath row) — permanently not a client row.
      continue
    }
    if (platforms !== undefined && platforms.includes('terminal')) roster.push(name)
  }
  return roster
}

/**
 * Boot the terminal client plane in-process and return its sessions service.
 * @param ctx - host plugin context (apiProxy owner).
 * @param transport - the composed fetch handler.
 * @returns the client root context and its sessions service.
 */
async function bootTerminalPlane(ctx: Context, transport: { fetch: typeof fetch }): Promise<{ root: Context; sessions: SessionRuntime }> {
  const profileRequire = createRequire(join(ctx.baseUrl ?? process.cwd(), 'package.json'))
  const roster = scanTerminalRoster(ctx.loader, profileRequire)
  if (roster.length === 0) {
    throw new Error('cli-app: no terminal client plugins composed; the cli profile must mount the terminal roster')
  }
  const root = new Context()
  await root.plugin(Loader, {
    ...(ctx.baseUrl === undefined ? {} : { baseUrl: ctx.baseUrl }),
  })
  root.provide('cliTransport', transport)
  root.provide('cliStartup', ctx.cliStartup)
  const loader = root.loader
  // Node resolves each package MAIN (the empty host half) on a bare import;
  // the browser's module system maps package names to client bundles. Mount
  // the client-node subpath so the terminal halves apply instead.
  await Promise.all(roster.map(async (name) => {
    await loader.create({ name: name + '/client-node' })
  }))
  await loader.await()
  for (const entry of loader.entries()) {
    const fiber = entry.fiber
    if (fiber === undefined || fiber.state !== FiberState.ACTIVE) {
      throw new Error('cli-app: terminal client plugin ' + JSON.stringify(entry.options.name) + ' failed to activate')
    }
  }
  const sessions = root.get('sessions', false) as SessionRuntime | undefined
  if (sessions === undefined) {
    throw new Error('cli-app: terminal plane booted without the sessions service')
  }
  return { root, sessions }
}

/** Open or create the startup session. */
async function openSession(sessions: SessionRuntime, ctx: Context): Promise<void> {
  const startup = ctx.cliStartup
  // An explicit id adopts the persisted session through the create handler
  // (same wire path the web resume uses); a fresh id mints one. Opening
  // directly would race the list store's first pull.
  const id = await sessions.create({
    ...(startup.sessionId !== undefined ? { sessionId: SessionId(startup.sessionId) } : {}),
    ...(startup.cwd !== undefined ? { cwd: startup.cwd } : {}),
  })
  sessions.open(id)
  // The one-shot --model/--permission flags apply inside the terminal plane
  // (the conversation plugin owns the session face and the connection api).
}

/**
 * Runner body: boot the terminal plane, open the session, and in print mode
 * wait for the run to quiesce before requesting exit.
 * @param ctx - host plugin context.
 */
async function run(ctx: Context): Promise<void> {
  const apiProxy = ctx.apiProxy
  const hostConnection = ctx.get('connection') as HostConnectionLike | undefined
  const composed = hostConnection === undefined
    ? toFetchHandler(apiProxy)
    : hostConnection.createSharedFetchHandler('/api', toFetchHandler(apiProxy))
  // The shared-channel handler receives a WHATWG Request (the web bridge
  // normalizes); the in-process client hands (URL, init) — normalize here so
  // both handler shapes see one carrier face.
  const transport: { fetch: typeof fetch } = {
    fetch: (input, init) => composed.fetch(input instanceof Request ? input : new Request(input, init)),
  }
  const { root, sessions } = await bootTerminalPlane(ctx, transport)
  ctx.effect(() => () => { void root.fiber.dispose() }, 'cli-app: terminal plane teardown')

  await openSession(sessions, ctx)

  const startup = ctx.cliStartup
  if (startup.task === undefined) return

  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('cli-app: the launcher must provide ctx.appExit before the tree mounts')
  }
  const current = sessions.list.getSnapshot().current
  if (current === undefined) {
    exit(1)
    return
  }
  const binding = sessions.binding(current)
  if (binding === undefined) {
    exit(1)
    return
  }
  const face = binding.session
  let sawRunning = false
  face.subscribe(() => {
    const snapshot = face.getSnapshot()
    if (snapshot.running) sawRunning = true
    const done = !snapshot.running && (sawRunning || snapshot.promptError !== null || snapshot.openError !== null)
    if (!done) return
    exit(snapshot.promptError !== null || snapshot.openError !== null ? 1 : 0)
  })
}

/**
 * Mount the cli runner.
 * @param ctx - plugin context carrying the gateway and startup services.
 */
export function apply(ctx: Context): void {
  void run(ctx).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write('dsh: ' + message + '\n')
    const exit = ctx.get('appExit')
    if (exit === undefined) process.exit(1)
    else exit(1)
  })
}
