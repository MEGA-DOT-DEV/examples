# Wards: what agents may do

Wards are rules in code. A ward holds no matter what an agent was told or decides: the agent's command fails, and the agent gets the reason as the result.

## Branches

A guarded branch is protected from every agent. What happens when an agent pushes to it is set by `wards.branches.onPush`. Pushes to other branches are always allowed.

| Key | Type | Default | What it does |
|---|---|---|---|
| `wards.branches.guarded` | list of strings | `[]` | Branch names that are guarded, for example `["release"]`. |
| `wards.branches.onPush` | `"allow"`, `"confirm"` or `"block"` | `"confirm"` | A push to a guarded branch: `"allow"` lets it through, `"confirm"` asks you each time, `"block"` refuses it. |
| `wards.branches.allowForce` | boolean | `false` | Allow `push --force` to any branch. |

## Shell

| Key | Type | Default | What it does |
|---|---|---|---|
| `wards.shell.deny` | list of strings | `[]` | Command prefixes an agent may never run, for example `["rm -rf", "docker system prune"]`. |
| `wards.shell.confirm` | list of strings | `[]` | Command prefixes that need your yes each time. |

## Network and secrets

| Key | Type | Default | What it does |
|---|---|---|---|
| `wards.net.mode` | `"open"`, `"listed"` or `"sealed"` | `"open"` | `"open"`: any host. `"listed"`: only the hosts in `wards.net.hosts`. `"sealed"`: no network. |
| `wards.net.hosts` | list of strings | `[]` | Host names allowed in `"listed"` mode. |
| `wards.secrets.mask` | boolean | `true` | Replace values that look like keys with `***` in everything an agent reads. |

## Example

```json
{
  "wards": { "shell": { "deny": ["rm -rf"] }, "net": { "mode": "listed", "hosts": ["registry.npmjs.org"] } }
}
```
