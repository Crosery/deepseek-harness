# Terminal CLI

English | [中文](cli.zh.md)

`dsh cli` runs the DeepSeek Harness agent in the terminal. It boots the same host composition as the web surface — agent core, tools, sandbox, persistence — and mounts a terminal client plane over an in-process transport: no browser, no webserver listener, no React. Everything is a plugin here too: terminal feature packages compose into the transcript through the kernel's node-renderer, command, and pre-line registries, and the roster is patchable through the cli profile like any other profile.

## Run

```sh
dsh cli                        # interactive session
dsh cli "run the tests"        # answer one task, print the run, and exit
dsh cli --session <id>         # resume a session
dsh cli --cwd <dir> --model provider/model --permission workspace-write
```

## Commands

`/help`, `/sessions [id-prefix]`, `/new`, `/model [n]`, `/like [note]`, `/dislike [note]`, `/memory`, `/quit`, and the host commands `/plan`, `/goal`, `/compact`, `/permission <preset>`, `/feedback`, `/export`.

Approval and ask_user_question prompts render inline and switch the input line into answer mode. `@path/to/image.png` attaches an image.

## Display

A blank interactive session opens with a welcome box: the pixel whale, the active model, and the command hints. While the model reasons, the input line shows a pulsing `⠋ thinking…` instead of the raw reasoning stream; the settled reasoning prints once, dimmed with a `·` prefix, and the answer streams line by line in place.

Typing `/` or `\` opens the live command menu under the input: client commands, host commands, and the session's skills, filtered as you type, with the cursor on the first match and descriptions beside each entry. `⏎` runs the line; both prefixes dispatch identically.

Tool calls render like the web: a live braille activity line while they run (one dim pending row per call in piped runs), then an omp-style card — `✓ name: label · 0.5s` with a dimmed preview of the render-intent output (terminal text, diff hunks, search matches, read content, web output) and nested subcalls indented below. Command outcomes print under their `⌘` line as `✓`/`✗` rows.

Steered messages appear as user rows with a `↪` marker, injected or recalled context as dim `▸`/`↩` rows with the producer label, and model retries as dim `↻` notices. Each assistant message ends with a dim footer — `↑ 8.8k ↓ 63 · 2.0s · ttft 1.0s` — the billed tokens, latency, and time-to-first-token, like the web's stats and omp's footer.

## Memory

For the lowest footprint, run with a bounded heap:

```sh
NODE_OPTIONS="--max-old-space-size=256 --optimize-for-size" dsh cli
```

Measured (macOS arm64, Node 24): idle RSS ~158 MB with the flags above (~223 MB default V8), ~163 MB during a live turn, startup to first streamed output ~1.6 s including one model round-trip. The cli profile disables the OTel telemetry row; the terminal surface uploads no telemetry.
