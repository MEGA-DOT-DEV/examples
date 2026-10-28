# One repository for all services

Status: accepted, 2024.

api, web and worker live in one repository. A change that touches two services is one pull request, and shared types never drift.

We gave up: separate CI pipelines. CI now builds only the services that a pull request changes.
