---
related: [architecture/data-model.md]
---
# Restore a backup

1. Find the snapshot in the storage console, under "db-nightly".
2. Start a new database from it with `make db-from-snapshot ID=<id>`.
3. Point a scratch copy of the api at it and check the rows you need.
4. Copy only those rows back. Never swap the whole database.

Ask in #platform before step 4 if more than one customer is affected.
