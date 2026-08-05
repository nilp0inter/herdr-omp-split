# Herdr Split

A [Herdr](https://github.com/herdrdev/herdr) plugin that forks the current
[omp](https://github.com/can1357/oh-my-pi) session and opens the original
conversation in a new tab.

Use it when you want to split a session into two independent conversations:

- The current pane keeps a fork of the session. It is a full copy, so you can
  continue working without touching the original history.
- A new tab resumes the original session. Both sides are normal persisted omp
  sessions with the full TUI, `/tree`, `/fork`, compaction, and so on.

## How it works

The plugin drives the running omp instance through Herdr's pane API:

1. Read the current omp session file from the pane's reported agent session.
2. Send `/fork` into the pane. omp copies the session into a new file and
   switches the pane to the clone; the original file stays on disk.
3. Wait until the pane reports the new session file.
4. Create a new tab in the same workspace and run
   `omp --resume <original-session-file>` in it.

`--resume <path>` opens the exact session file. `--continue` is not used:
it follows a per-terminal breadcrumb and would resolve to the wrong session.

## Install

```sh
herdr plugin install nilp0inter/herdr-omp-split
```

Or link the local checkout while developing:

```sh
herdr plugin link /path/to/herdr-omp-split
```

The plugin registers one action, `split` ("Split session"). Trigger it from a
keybinding in `~/.config/herdr/config.toml`:

```toml
[[keys.command]]
command = "split.split"
description = "Split session"
key = "prefix+s"
type = "plugin_action"
```

Run it manually with:

```sh
herdr plugin action invoke split
```

## Requirements

- The current pane must run omp with a persisted session (`/fork` refuses
  in-memory sessions).
- The omp session must be idle. `/fork` is rejected while a response is
  streaming, so the plugin refuses to start in that case.

## Development

```sh
bun install --frozen-lockfile
bun test
bunx tsc --noEmit
```
