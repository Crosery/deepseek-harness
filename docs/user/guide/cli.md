# Terminal CLI

English | [中文](cli.zh.md)

`dsh cli` runs the DeepSeek Harness agent in the terminal. It boots the
same host composition as the web surface — agent core, tools, sandbox,
persistence — and mounts a terminal client plane over an in-process
transport: no browser, no webserver listener, no React. Everything is a
plugin here too: terminal feature packages compose into the transcript
through the kernel's node-renderer, command, and pre-line registries, and
the roster is patchable through the cli profile like any other profile.

## Run

```sh
dsh cli                        # interactive session
dsh cli "run the tests"        # answer one task, print the run, and exit
dsh cli --session <id>         # resume a session
dsh cli --cwd <dir> --model provider/model --permission workspace-write
```

## Commands

`/help`, `/sessions [id-prefix]`, `/new`, `/model [n]`, `/like [note]`,
`/dislike [note]`, `/memory`, `/quit`, and the host commands `/plan`,
`/goal`, `/compact`, `/permission <preset>`, `/feedback`, `/export`.

Approval and ask_user_question prompts render inline and switch the input
line into answer mode. `@path/to/image.png` attaches an image.

## Memory

For the lowest footprint, run with a bounded heap:

```sh
NODE_OPTIONS="--max-old-space-size=256 --optimize-for-size" dsh cli
```

Measured (macOS arm64, Node 24): idle RSS ~158 MB with the flags above
(~223 MB default V8), ~163 MB during a live turn, startup to first streamed
output ~1.6 s including one model round-trip. The cli profile disables the
OTel telemetry row; the terminal surface uploads no telemetry.
