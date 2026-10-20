import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  pgPolicy,
  pgRole,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth'

/**
 * The runtime role for todo CRUD. Created by devenv's postgres `initialScript`,
 * so it is declared `.existing()` here — drizzle-kit references it in the policy
 * but never tries to create or drop it.
 */
export const appRole = pgRole('todo_app').existing()

/**
 * `app.user_id` is a per-transaction GUC set by `withUser()` in src/db/index.ts.
 * `current_setting(..., true)` returns NULL instead of erroring when unset, and
 * `user_id = NULL` is NULL (never true) — so a handler that forgets to set the
 * GUC sees zero rows rather than everyone's rows. Fail-closed by construction.
 */
const currentUserId = sql`current_setting('app.user_id', true)`

export const todos = pgTable(
  'todos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    completed: boolean('completed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('todos_user_id_created_at_idx').on(t.userId, t.createdAt),

    // USING filters rows the role may read/update/delete.
    // WITH CHECK filters rows the role may write — without it a user could
    // INSERT or UPDATE a row with someone else's user_id.
    pgPolicy('todos_owner_only', {
      as: 'permissive',
      for: 'all',
      to: appRole,
      using: sql`${t.userId} = ${currentUserId}`,
      withCheck: sql`${t.userId} = ${currentUserId}`,
    }),
  ],
)
