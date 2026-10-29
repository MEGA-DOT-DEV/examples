# Lore: what goes into the prompt

Lore is text that Tarnwick adds to an agent's prompt by itself: pinned files, and a rules file.

Pinned files are added in the order you list them. `lore.refresh` sets how often: with `"each_task"` they go into the first prompt of each task only, with `"each_turn"` into every prompt, so the agent never loses them in a long task. Paths are relative to the project root.

| Key | Type | Default | What it does |
|---|---|---|---|
| `lore.pinned` | list of strings | `[]` | Files to add to the prompt, for example `["docs/architecture.md"]`. |
| `lore.refresh` | `"each_turn"`, `"each_task"` or `"once"` | `"each_task"` | How often pinned files are added. `"once"`: only when the lead starts. |
| `lore.maxPinnedTokens` | integer | `4000` | Pinned files are cut at this many tokens in total. |
| `lore.rulesFile` | string | `"AGENTS.md"` | The rules file that every agent reads when it starts. |
| `lore.history.keepDays` | integer | `30` | How many days Tarnwick keeps the history of past tasks. |

## Example

```json
{
  "lore": { "pinned": ["docs/architecture.md"], "maxPinnedTokens": 6000 }
}
```
