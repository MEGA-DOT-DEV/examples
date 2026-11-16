// The Outbox cell stands for the outside world: the user's mailbox.
// It is a separate Durable Object, so a crash of Specter cannot roll it back,
// and it counts every delivery attempt, so a duplicate send is visible.

import { DurableObject } from 'cloudflare:workers'

export type Delivery = {
  readonly key: string
  readonly to: string
  readonly body: string
  readonly at: number
  readonly attempts: number
}

export class Outbox extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never)
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS delivery (
			key TEXT PRIMARY KEY,
			"to" TEXT NOT NULL,
			body TEXT NOT NULL,
			at INTEGER NOT NULL,
			attempts INTEGER NOT NULL
		)`)
  }

  /**
   * Deliver once per key. A repeated key adds an attempt and returns the first
   * delivery.
   */
  deliver(key: string, to: string, body: string): Delivery {
    return this.ctx.storage.sql
      .exec<Delivery>(
        `INSERT INTO delivery (key, "to", body, at, attempts) VALUES (?, ?, ?, ?, 1)
				 ON CONFLICT (key) DO UPDATE SET attempts = attempts + 1
				 RETURNING key, "to", body, at, attempts`,
        key,
        to,
        body,
        Date.now(),
      )
      .one()
  }

  find(key: string): Delivery | undefined {
    return this.ctx.storage.sql
      .exec<Delivery>(
        `SELECT key, "to", body, at, attempts FROM delivery WHERE key = ?`,
        key,
      )
      .toArray()[0]
  }

  list(): Delivery[] {
    return this.ctx.storage.sql
      .exec<Delivery>(
        `SELECT key, "to", body, at, attempts FROM delivery ORDER BY at`,
      )
      .toArray()
  }
}
