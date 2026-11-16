# Rubric for the recorded ambient week

Written before the first real-model run and not changed after it. The week is `events/week.json`; `npm run week` plays it and writes `run/week/week-report.md`. The report counts; you judge it against this rubric.

Each moment of the week carries `expect`: what a good partner does after it, from the ladder of steps (nothing, record, note, digest item, message). `quiet` means nothing the user sees beyond the knowledge base: no email, no pull message.

## Questions

1. **Did it notice what mattered and ignore the rest?** For each moment: the first look's decision on its batch, and whether a run wrote a note when `expect` is `note`. A moment marked `quiet` that wakes a run is not a failure by itself; a moment marked `quiet` that reaches the user is.
2. **Was each interruption worth it? Did it go quiet on the busy day?** Every email and pull message, with its `why_now`, against the moments before it. On the busy day (Tuesday) no email and no pull message, and the first look should not wake runs for the user's work edits.
3. **After the deletion and the ignored digest, did its behaviour change?** The deleted note is never written again (harness), and Specter's own documents (attention budget, watches, agenda) record what it learned; a later digest or note reflects it. One ignored digest must not switch Specter off: silence is weak.
4. **Can the journal explain each wake and each silence?** Every run has a cause row with a reason (agenda item, first look, heartbeat) and a decision record. Every batch has a `look` row with a reason.

## Counts (from the log, by `scripts/week.ts`)

- **False alarms:** emails or pull messages to the user caused by a `quiet` moment, sent on the busy day, or with no new material since the last one.
- **Missed moments:** moments marked `note`, `digest` or `message` with no Specter note, digest line or message that names their source by the end of the week (`message` moments: by their deadline).
- **Messages sent:** emails and pull messages to the user, and refused attempts with the refusal reason.
- **Cost:** USD from the model usage of every first look and every run.
- **Records:** runs without a decision record written by the agent itself; batches without a `look` row.

## Pass bar

The week passes when: zero false alarms; at most one missed moment; no email or pull message on the busy day; the deleted note never comes back; every run and every batch has its record. Anything else is reported as it happened, with the rows that show it.
