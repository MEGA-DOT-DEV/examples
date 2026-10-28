---
related: [decisions/why-we-deploy-this-way.md, architecture/system-architecture.md, runbooks/incident-response.md]
---
# Rollback policy

Roll back first, debug later.

- If the error rate stays above 2% for 5 minutes after a cutover, revert to the previous tag with `shipctl revert`. Whoever runs the cutover decides. No approval needed.
- Never revert a schema migration. Ship a fix forward on the next train, or ask the release captain for an urgent slot.
- Post in #incidents when you revert, and write a short note within one working day.
