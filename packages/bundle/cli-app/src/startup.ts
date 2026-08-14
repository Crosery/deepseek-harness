/**
 * The cli app's command-line provider: it parses the `dsh cli` flag family
 * (--cwd, --session, --model, --permission) and an optional one-shot task
 * positional, then provides the immutable values as {@link CLI_STARTUP_SERVICE}.
 * Rows that need the values inject that service before reading their config.
 * @module @deepseek-ai/dsh-cli-app/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'cli-startup'

/** Services required before the flags can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this ordinary plugin and injected by flag-configured rows. */
export const CLI_STARTUP_SERVICE = 'cliStartup'

/** What the cli rows read from {@link CLI_STARTUP_SERVICE}. */
export interface CliStartupValues {
  /** --cwd, absent when the invocation did not name one (process cwd wins). */
  cwd?: string
  /** --session, absent for a fresh session. */
  sessionId?: string
  /** --model, absent when the saved or default selection wins. */
  model?: string
  /** --permission preset applied after the session opens. */
  permission?: string
  /** The one-shot task text; absent means interactive mode. */
  task?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The parsed cli invocation, provided by the startup plugin. */
    cliStartup: CliStartupValues
  }
}

/** The cli flag family, as commander parsed it. */
interface CliOptions {
  cwd?: string
  session?: string
  model?: string
  permission?: string
}

/**
 * This app's command: its flags, its description, and its help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function cliCommand(): Command {
  return new Command()
    .name('dsh cli')
    .description('Run the DeepSeek Harness agent in the terminal.')
    .helpOption('-h, --help', 'show this help')
    .argument('[task...]', 'one-shot task text; when given, print the run and exit (multiple words joined by spaces)')
    .option('--cwd <dir>', 'working directory for the session')
    .option('--session <id>', 'resume the session with this id')
    .option('--model <model>', 'model for this session')
    .option('--permission <preset>', 'permission preset (read-only | workspace-write | danger-full-access)')
    .addHelpText('after', `
Examples:
  dsh cli                                     interactive terminal session
  dsh cli "run the tests"                     answer one task and exit
  dsh cli --session session-abc123            resume a previous session
`)
}

/**
 * Parse and provide the cli invocation as an ordinary Cordis service. On
 * --help or a usage error nothing is provided.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = cliCommand()
  program.action(() => {
    const options = program.opts<CliOptions>()
    const task = program.args.join(' ').trim()
    ctx.provide(CLI_STARTUP_SERVICE, {
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      ...(options.session !== undefined ? { sessionId: options.session } : {}),
      ...(options.model !== undefined ? { model: options.model } : {}),
      ...(options.permission !== undefined ? { permission: options.permission } : {}),
      ...(task !== '' ? { task } : {}),
    } satisfies CliStartupValues)
  })
  parseCmdline(ctx, program)
}
