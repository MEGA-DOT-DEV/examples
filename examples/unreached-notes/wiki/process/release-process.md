---
related: [process/on-call-rotation.md, runbooks/deploy-checklist.md, decisions/why-we-deploy-this-way.md]
---
# Release process

Merged pull requests ride the next release train.

- Versions: `v<year>.<n>`, for example v2026.41. The number goes up by one with each release.
- Changelog: the author of each pull request writes one line in CHANGELOG.md.
- The release captain collects the merged pull requests, checks the changelog and pushes the tag. The captain is the primary on call that week (see On-call rotation).
- Hotfixes: branch from the last tag, open a pull request with the label "hotfix", and ask the release captain for a slot.
