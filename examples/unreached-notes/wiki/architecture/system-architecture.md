---
related: [decisions/why-we-deploy-this-way.md, policies/rollback-policy.md, architecture/data-model.md]
---
# System architecture

Fernbrook is three services and one database:

- api: the public REST API, 6 pods.
- web: the customer app, static files behind the CDN.
- worker: background jobs from the queue (invoices, emails, exports).
- Postgres 16: one primary and one read replica.

All traffic enters through the edge router. When a new version goes out, the edge router first sends 10% of traffic to it for 20 minutes: the canary. If the error rate stays normal, it moves the rest.

Schema migrations run as their own job (`shipctl migrate`) before the new pods start. During the canary, the old and the new version serve traffic at the same time, so every migration must be backward compatible: expand first (add columns), contract later (drop them in a later train).
