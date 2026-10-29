# Tarnwick settings: overview

Tarnwick reads one file when it starts: `~/.tarnwick/settings.json`. It holds one JSON object. Every setting has a default, so the file lists only what you change.

Tarnwick checks the file when it starts. An unknown key or a value of the wrong type stops the start, and Tarnwick prints the line it could not read. Keys are case-sensitive and use camelCase.

## Units

- Durations are whole seconds: `600` is ten minutes. Never write `"10m"`.
- Money is whole US cents: `150` is $1.50. Never write `1.5` or `"$1.50"`.

## Sections

| Section | Page | What it sets |
|---|---|---|
| `crew` | crew | Which model tier the lead and the workers use, and errands |
| `ledger` | crew | Spending caps |
| `pens` | pens | Where workers run, and what happens when the terminal closes |
| `signals` | signals | Notifications on your handset and in the terminal |
| `wards` | wards | Protected branches, shell commands and network access |
| `lore` | lore | Files added to the prompt, and the rules file |

## Top-level settings

| Key | Type | Default | What it does |
|---|---|---|---|
| `profile` | string | `"default"` | A name for this setup, shown in the status line. |
| `editor` | string | `""` | The command that opens a file for you, for example `"code -w"`. Empty: Tarnwick prints the path. |
| `telemetry` | `"off"`, `"minimal"` or `"full"` | `"minimal"` | What Tarnwick sends about crashes and usage. |
| `updates` | `"auto"`, `"notify"` or `"manual"` | `"notify"` | How Tarnwick updates itself. |

## Example

```json
{
  "profile": "work",
  "pens": { "layout": "grid" },
  "signals": { "chime": { "enabled": false } }
}
```
