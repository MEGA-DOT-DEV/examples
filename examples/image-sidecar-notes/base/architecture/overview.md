# Architecture overview

Four services handle a payment. The gateway takes requests from the client apps. The ledger records every money movement. Postgres stores the ledger. Writes that fail go to the retry queue.

The links between the services and the port of each one are on the service map: architecture/services.png. We keep the map as a drawing, so it changes in one place.
