# Ledger service

The ledger records every money movement as a double entry. It never updates a row: a correction is a new entry.

Its database is a Postgres instance that only the ledger uses. For the port and the connection settings, see the service map (architecture/services.png).

Owner: the core payments squad.
