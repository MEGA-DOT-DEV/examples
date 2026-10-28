---
related: [process/release-process.md, process/on-call-rotation.md, decisions/why-we-deploy-this-way.md, policies/rollback-policy.md]
---
# Deploy checklist

Use this list every time you deploy to production.

1. Run tests: `make test` must pass on main.
2. Tag the release: `git tag v2026.<n>`, then push the tag. CI ships every pushed tag.
3. Notify #eng: post the tag and a link to the changelog.
4. Monitor: watch the "api errors" dashboard for 30 minutes.

Who writes the changelog and pushes the tag: see Release process.
Who to page when something breaks: see On-call rotation.
