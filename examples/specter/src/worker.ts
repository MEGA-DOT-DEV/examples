// The Worker: stateless entry. It hands every API request to the one Specter
// cell and serves the dashboard from `public/`. The cron is the watchdog of the
// wake owner.

import type { Env } from './types.ts'

export { Outbox } from './outbox.ts'
export { Specter } from './specter.ts'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/outbox') {
      return Response.json(await env.OUTBOX.getByName('adam').list())
    }
    if (url.pathname.startsWith('/api/')) {
      return env.SPECTER.getByName('specter').fetch(request)
    }
    return env.ASSETS.fetch(request)
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    // The watchdog: a tick starts a stopped cell, which re-arms its alarm, and
    // runs any wake that is due.
    await env.SPECTER.getByName('specter').tick()
  },
} satisfies ExportedHandler<Env>
