# Local setup

1. Install Node 24 and Docker.
2. Clone the monorepo and run `make setup`. It starts Postgres and the queue in Docker.
3. Copy `.env.example` to `.env`. Ask in #platform for the sandbox keys.
4. Run `make dev`. The app opens on port 3000.

If `make setup` fails on a Mac, update Docker first.
