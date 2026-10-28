# Postgres over MongoDB

Status: accepted, 2023.

Invoices, payments and customers have strict relations, and we need transactions across them. We keep everything in Postgres. JSON columns cover the few places with loose data, such as invoice templates.

We gave up: a flexible schema. Every new field needs a migration.
