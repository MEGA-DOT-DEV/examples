# Pens: where workers run

Each worker runs in a pen: a terminal pane that a small Tarnwick server owns, not your terminal window. You can look into a pen, type into it, or leave it in the background.

When you close the terminal, the server decides what happens to the pens. With `"end"`, it stops every worker. With `"linger"`, the workers keep running for `pens.lingerFor` seconds and you can come back to them with `tarnwick attach`.

| Key | Type | Default | What it does |
|---|---|---|---|
| `pens.onTerminalClose` | `"end"`, `"linger"` or `"ask"` | `"end"` | What happens to running workers when you close the terminal. `"ask"` asks you each time. |
| `pens.lingerFor` | integer | `900` | With `"linger"`: how many seconds the workers keep running. `0`: until each worker's job ends. |
| `pens.layout` | `"stack"`, `"grid"` or `"single"` | `"stack"` | How pens show when you attach. |
| `pens.maxOpen` | integer | `6` | The most pens that show at once. More pens run, but stay hidden. |
| `pens.nameFrom` | `"ticket"`, `"branch"` or `"prompt"` | `"ticket"` | Where a pen gets its name. |
| `pens.reviveOnBoot` | boolean | `false` | After a restart of the computer, start the workers that were running again. |

## Example

```json
{
  "pens": { "layout": "grid", "maxOpen": 4 }
}
```
