# User accounts

Status: implemented (June 2026)

- Every user has one role per workspace: owner, admin, member or guest.
- One permission check runs on every request: `can(user, action, resource)`. A new feature adds its action to the permission table in `auth/permissions.ts`; it does not write its own role checks.
