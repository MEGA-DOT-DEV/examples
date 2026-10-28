---
related: [decisions/postgres-over-mongo.md, architecture/system-architecture.md]
---
# Data model

Main tables: customers, invoices, invoice_lines, payments, partners.

- An invoice belongs to one customer and has many lines.
- A payment can cover several invoices; payment_allocations joins them.
- Amounts are integers in cents. Never store money as a float.
- Migrations live in `db/migrations`, one file per change, named by date.
