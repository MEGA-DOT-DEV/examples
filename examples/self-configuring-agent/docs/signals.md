# Signals: notifications

Tarnwick can tell you when something happens: on your handset (the Tarnwick app on your phone, paired with `tarnwick pair`), with a chime in the terminal, and in a daily digest.

## Events

| Event | When |
|---|---|
| `"job_ended"` | A worker's job ended, done or failed. |
| `"job_stalled"` | A worker has not written anything for 5 minutes. |
| `"needs_human"` | A worker waits for your answer. |
| `"cap_reached"` | A task reached its ledger cap. |

## `signals`

| Key | Type | Default | What it does |
|---|---|---|---|
| `signals.handset.enabled` | boolean | `false` | Send events to your handset. |
| `signals.handset.events` | list of events | `["needs_human"]` | Which events go to the handset. |
| `signals.handset.minRuntime` | integer | `0` | Send `"job_ended"` only for jobs that ran at least this many seconds. Other events are not affected. |
| `signals.handset.quietHours` | string | `""` | Hours with no handset events, as `"HH-HH"`, for example `"22-07"`. Empty: none. |
| `signals.chime.enabled` | boolean | `true` | Play a chime in the terminal. |
| `signals.chime.events` | list of events | `["needs_human"]` | Which events chime. |
| `signals.digest.enabled` | boolean | `false` | Write a daily digest of all jobs to `~/.tarnwick/digest/`. |
| `signals.digest.hour` | integer | `18` | The hour of the day (0 to 23) when the digest is written. |

## Example

```json
{
  "signals": { "chime": { "events": ["needs_human", "job_stalled"] } }
}
```
