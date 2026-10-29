# Crew and ledger: models and spending

Tarnwick does not use model names. It has three tiers, and your provider account maps each tier to a model:

| Tier | Cost | Use it for |
|---|---|---|
| `"summit"` | highest | Hard work: planning, review, large changes |
| `"ridge"` | middle | Most coding work |
| `"meadow"` | lowest | Small, clear changes |

The lead is the agent you talk to. Workers are the agents the lead starts. An errand is a task that changes at most `crew.errands.maxLines` lines. When errands are enabled, Tarnwick runs every errand on the errand tier, not on the tier of the agent that started it.

## `crew`

| Key | Type | Default | What it does |
|---|---|---|---|
| `crew.lead.tier` | tier | `"summit"` | The lead's tier. |
| `crew.lead.effort` | `"brisk"`, `"steady"` or `"deep"` | `"steady"` | How long the lead thinks before it answers. |
| `crew.workers.tier` | tier | `"ridge"` | The tier of each worker. |
| `crew.workers.max` | integer | `3` | How many workers can run at the same time. |
| `crew.errands.enabled` | boolean | `false` | Run errands on their own tier. |
| `crew.errands.tier` | tier | `"ridge"` | The errand tier. |
| `crew.errands.maxLines` | integer | `40` | The largest change, in lines, that still counts as an errand. |
| `crew.errands.effort` | `"brisk"`, `"steady"` or `"deep"` | `"brisk"` | How long an errand thinks. |

## `ledger`

The ledger counts what each task costs. A task is one prompt from you and all the work it starts, workers included.

| Key | Type | Default | What it does |
|---|---|---|---|
| `ledger.perTaskCents` | integer | `0` | The cap for one task, in cents. `0`: no cap. |
| `ledger.atCap` | `"note"`, `"hold"` or `"halt"` | `"note"` | What happens at the cap. `"note"` writes a line and goes on. `"hold"` pauses the task and asks you whether to go on. `"halt"` stops the task without asking. |
| `ledger.perDayCents` | integer | `0` | The cap for one day, in cents. `0`: no cap. At this cap Tarnwick always halts. |
| `ledger.showInStatus` | boolean | `true` | Show the cost of the current task in the status line. |

## Example

```json
{
  "crew": { "workers": { "max": 5 } },
  "ledger": { "perDayCents": 2000 }
}
```
