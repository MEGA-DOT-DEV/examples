// The Specter cell: the one Durable Object that owns all state and runs the
// agent. celld keeps its SQLite durable before any response; an evicted or
// killed cell starts again in this constructor, and its alarm brings it back
// with no client attached.

import { DurableObject } from 'cloudflare:workers'
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import type { Models } from '@earendil-works/pi-ai/models'
import { Harness, type Submission, type Wake } from '@earendil-works/pi-durable'
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite'
import { DurableObjectSqliteDatabase } from '@earendil-works/pi-durable/storage/sqlite/cloudflare'
import { SAMPLES } from '../events/index.ts'
import { SEED } from '../workspace/index.ts'
import { createSpecterModels } from './brain.ts'
import { loadClock, now, realTime } from './clock.ts'
import { applyDeploy, CONFIG_PATH, postConfig } from './config.ts'
import { createFaults, postClock, postCrash, postFault } from './faults.ts'
import { postEvent } from './inbound.ts'
import { append, createLog, rowsAfter } from './log.ts'
import { firstLook } from './look.ts'
import { createRuns, scopeOf, specterRegistry } from './run.ts'
import { endSim, startSim } from './sim.ts'
import { state, tick } from './tick.ts'
import type { Env, Host, Row, RunScope } from './types.ts'
import { createWebTable } from './web.ts'
import {
  createWorkspace,
  filesResponse,
  readFile,
  seedWorkspace,
} from './workspace.ts'

/**
 * While work runs, the alarm also beats at this interval, so a killed node
 * resumes it.
 */
const HEARTBEAT_MS = 5_000

type Route = (cell: Specter, request: Request, url: URL) => Promise<Response>

/**
 * The cell's HTTP API. The Worker forwards every `/api/*` request here. One
 * line per route.
 */
const ROUTES: Record<string, Route> = {
  'GET /api/health': async () => Response.json({ ok: true }),
  'GET /api/config': async (cell) =>
    new Response((await readFile(cell.db, CONFIG_PATH))?.text ?? '', {
      headers: { 'content-type': 'text/yaml; charset=utf-8' },
    }),
  'GET /api/rows': async (cell, _request, url) =>
    Response.json(
      await rowsAfter(cell.db, Number(url.searchParams.get('after') ?? 0)),
    ),
  'GET /api/files': async (cell, _request, url) =>
    filesResponse(cell.db, url.searchParams.get('path')),
  'GET /api/samples': async () => Response.json(SAMPLES),
  'GET /api/state': async (cell) => state(cell),
  'POST /api/events': async (cell, request) => {
    const response = await postEvent(cell, request)
    if (response.ok) {
      await tick(cell)
    }
    return response
  },
  'POST /api/control/config': async (cell, request) => {
    const response = await postConfig(cell.db, request)
    if (response.ok) {
      await tick(cell)
    }
    return response
  },
  'POST /api/control/fault': async (cell, request) =>
    postFault(cell.db, request),
  'POST /api/control/clock': async (cell, request) => {
    const response = await postClock(cell.db, request)
    if (response.ok) {
      await tick(cell)
    }
    return response
  },
  'POST /api/control/crash': async (cell) =>
    postCrash(cell.db, (reason) => cell.crash(reason)),
  'POST /api/sim/start': async (cell) => {
    const response = await startSim(cell)
    await tick(cell)
    return response
  },
  'POST /api/sim/end': async (cell) => {
    const response = await endSim(cell)
    if (response.ok) {
      await tick(cell)
    }
    return response
  },
}

/** The cell takes no props. */
type Props = Record<string, never>

export class Specter extends DurableObject<Env, Props> implements Host {
  declare readonly ctx: DurableObjectState<Props>
  declare readonly env: Env
  readonly db: DurableObjectSqliteDatabase
  harness!: Harness
  /**
   * The models of every run and of the first look: the lab brain and each real
   * provider.
   */
  models!: Models
  /**
   * The next wake in harness time (`src/clock.ts`); tick() sets it, the alarm
   * includes it. Until the first tick: a fallback.
   */
  due: number | undefined = now() + 60_000
  /**
   * A run is live or a first look runs; tick() sets it. The heartbeat then
   * holds even while pi has nothing to run.
   */
  working = false
  /**
   * A first look is in flight in this process. One at a time; a killed node
   * looks at the batch again.
   */
  looking = false
  /**
   * Runs this process waits on, to tick as soon as they settle. Only a
   * speed-up: the heartbeat tick is what is durable.
   */
  readonly #waiting = new Set<string>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Host tables share pi's queue through one adapter, so a pi commit never
    // rolls back a host write.
    this.db = new DurableObjectSqliteDatabase(ctx.storage)
    void ctx
      .blockConcurrencyWhile(async () => {
        // A fallback before anything can throw: a cell whose open fails is
        // started again.
        const fallback = Date.now() + 60_000
        const current = await ctx.storage.getAlarm()
        if (current === null || current > fallback) {
          await ctx.storage.setAlarm(fallback)
        }
        await createLog(this.db)
        await loadClock(this.db)
        await createFaults(this.db)
        await createWorkspace(this.db)
        await createWebTable(this.db)
        await createRuns(this.db)
        await seedWorkspace(this.db, SEED)
        await applyDeploy(this.db)
        const storage = await SqliteStorage.open(this.db, { prefix: 'pi_' })
        this.models = createSpecterModels(env, this.db)
        this.harness = await Harness.open(
          storage,
          {
            models: this.models,
            registry: specterRegistry(this),
            // A failed alarm write, or a failed Session, resets the cell; the
            // alarm opens it again and tick() goes on.
            onWake: (wake) =>
              void this.arm(wake).catch(() => ctx.abort('alarm write failed')),
            onReport: (report) => {
              if (report.kind === 'storage_failed') {
                ctx.abort(`harness storage failed: ${String(report.error)}`)
              }
            },
          },
          context,
        )
        await append(this.db, {
          from: 'harness',
          to: 'harness',
          kind: 'boot',
          body: 'cell started',
        })
        await this.arm(this.harness.wake())
        this.harness.resume()
      })
      // A run that a killed node left half started or half ended is finished
      // here, before any new input.
      .then(() => tick(this))
  }

  scope(conversationId: number): Promise<RunScope> {
    return scopeOf(this.db, conversationId)
  }

  /** The cron's entry: the Worker calls it on every trigger. */
  async tick(): Promise<void> {
    await tick(this)
  }

  /** Tick once this run's submission settles. */
  awaitRun(run: string, submission: Submission): void {
    if (this.#waiting.has(run)) {
      return
    }
    this.#waiting.add(run)
    void submission
      .wait(context)
      .then(() => tick(this))
      .finally(() => this.#waiting.delete(run))
  }

  /**
   * Start the first look at a batch, unless one is in flight, and tick once it
   * wrote its decision.
   */
  startLook(rows: readonly Row[]): void {
    if (this.looking) {
      return
    }
    this.looking = true
    void firstLook(this.db, this.models, rows)
      // firstLook writes its own failure as a decision; failing to write even
      // that is a failed database, which the next tick reports.
      .catch(() => undefined)
      .finally(() => {
        this.looking = false
        void tick(this)
      })
  }

  /**
   * Keep one alarm at the earliest time anything must happen: pi's wake, the
   * next wake or batch close that tick() found, and a heartbeat while work is
   * active. An early alarm is harmless; a missing one strands work.
   */
  async arm(wake: Wake): Promise<void> {
    const heartbeat =
      wake.active || this.working ? Date.now() + HEARTBEAT_MS : undefined
    const due = this.due === undefined ? undefined : realTime(this.due)
    const times = [heartbeat, wake.at, due].filter(
      (t): t is number => t !== undefined,
    )
    if (times.length === 0) {
      await this.ctx.storage.deleteAlarm()
    } else {
      await this.ctx.storage.setAlarm(Math.min(...times))
    }
  }

  /**
   * Drop the cell in this process, as a crash would. It starts again at the
   * next request or alarm.
   */
  crash(reason: string): void {
    this.ctx.abort(reason)
  }

  override async alarm(): Promise<void> {
    await this.arm({ ...this.harness.wake(), active: true })
    this.harness.resume()
    await tick(this)
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const route = ROUTES[`${request.method} ${url.pathname}`]
    if (!route) {
      return Response.json(
        { error: `no route ${request.method} ${url.pathname}` },
        { status: 404 },
      )
    }
    return route(this, request, url)
  }
}
