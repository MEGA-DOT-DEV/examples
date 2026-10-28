---
related: [process/release-process.md]
---
# Feature flags

Status: accepted, 2025.

New features ship behind a flag, off by default. Product turns a flag on for a few test accounts first, then for everyone. A flag that has been on for everyone for 30 days gets removed from the code.

Flags are for features, not for config. Limits and prices stay in the settings table.
