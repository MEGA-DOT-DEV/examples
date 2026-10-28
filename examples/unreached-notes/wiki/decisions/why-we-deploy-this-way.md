---
related: [architecture/system-architecture.md, policies/rollback-policy.md, process/release-process.md]
---
# Why we deploy this way

Status: accepted, March 2026. Owner: platform team.

## Decision

Production changes go out only on the release train: every Tuesday and Thursday, with the cutover at 14:00 UTC. A change that misses a train waits for the next one. The release captain may add an urgent fix to a train, but never runs one outside the schedule.

Nothing goes to production in the freeze window, from Friday 12:00 UTC to Monday 09:00 UTC. Support runs with one person on weekends, and nobody should be paged for a change that could have waited.

## Why

Before the train, changes went out whenever they were ready, often ten a day. When something broke, nobody knew which change did it. Two fixed cutovers a week keep batches small and give everyone a time to watch.

## What we gave up

Speed for single small fixes. We accept that a typo fix can wait two days.
