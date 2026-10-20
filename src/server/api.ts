import { eq, inArray } from 'drizzle-orm'
import { Elysia, status } from 'elysia'
import { readAsUser, withUser } from '~/db'
import { todos } from '~/db/schema/todos'
import { auth } from '~/lib/auth'
import {
  todoBatchSchema,
  todoCreateSchema,
  todoParamsSchema,
  todoUpdateSchema,
} from '~/lib/validators'

/**
 * Resolves the better-auth session and rejects anonymous callers.
 * Downstream handlers get `user` and never see a request without one.
 */
const authenticated = new Elysia({ name: 'authenticated' }).resolve(
  { as: 'scoped' },
  async ({ request }) => {
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session) throw status(401, { error: 'Unauthenticated' })
    return { user: session.user }
  },
)

/**
 * CRUD over todos.
 *
 * Note what is *missing* from every query: a `where user_id = ...` clause.
 * `withUser()` opens a transaction as the `todo_app` role with `app.user_id`
 * set, and the RLS policy supplies that predicate for SELECT, INSERT, UPDATE
 * and DELETE alike. The handlers cannot forget it.
 */
const todoRoutes = new Elysia({ prefix: '/todos' })
  .use(authenticated)
  .get('/', async ({ user }) => {
    return await readAsUser(user.id, (tx) =>
      tx.select().from(todos).orderBy(todos.createdAt),
    )
  })
  .post(
    '/',
    async ({ user, body }) => {
      const [row] = await withUser(user.id, (tx) =>
        tx
          .insert(todos)
          // user_id comes from the session, never from the request body.
          .values({ id: body.id, title: body.title, userId: user.id })
          .returning(),
      )
      return status(201, row!)
    },
    { body: todoCreateSchema },
  )
  /**
   * One request, one Postgres transaction, any mix of writes.
   *
   * `withUser` opens the transaction and sets `app.user_id`; every statement
   * below runs inside it. Drizzle rolls back on any throw and rethrows, so the
   * `status(404, ...)` below both aborts the batch and becomes the response —
   * a batch that touches one row you don't own changes nothing at all.
   *
   * This is what the TanStack DB collection handlers call: one optimistic
   * transaction on the client maps to one transaction in the database, however
   * many rows it carries.
   */
  .post(
    '/batch',
    async ({ user, body }) => {
      return await withUser(user.id, async (tx) => {
        const inserted = body.insert?.length
          ? await tx
              .insert(todos)
              .values(body.insert.map((t) => ({ ...t, userId: user.id })))
              .returning()
          : []

        // Sequential on purpose: these share one connection, and each needs to
        // see the previous statement's effect.
        const updated: Array<typeof todos.$inferSelect> = []
        for (const { id, ...changes } of body.update ?? []) {
          const [row] = await tx
            .update(todos)
            .set(changes)
            .where(eq(todos.id, id))
            .returning()
          if (!row) throw status(404, { error: `No such todo: ${id}` })
          updated.push(row)
        }

        const deleted = body.delete?.length
          ? await tx
              .delete(todos)
              .where(inArray(todos.id, body.delete))
              .returning({ id: todos.id })
          : []
        if (deleted.length !== (body.delete?.length ?? 0)) {
          throw status(404, { error: 'Some of those todos do not exist' })
        }

        return { inserted, updated, deleted }
      })
    },
    { body: todoBatchSchema },
  )
  .patch(
    '/:id',
    async ({ user, params, body }) => {
      const [row] = await withUser(user.id, (tx) =>
        tx.update(todos).set(body).where(eq(todos.id, params.id)).returning(),
      )
      // Zero rows means "no such todo" or "not yours" — the two are
      // intentionally indistinguishable to the caller.
      if (!row) throw status(404, { error: 'Not found' })
      return row
    },
    { params: todoParamsSchema, body: todoUpdateSchema },
  )
  .delete(
    '/:id',
    async ({ user, params }) => {
      const [row] = await withUser(user.id, (tx) =>
        tx.delete(todos).where(eq(todos.id, params.id)).returning({ id: todos.id }),
      )
      if (!row) throw status(404, { error: 'Not found' })
      return { id: row.id }
    },
    { params: todoParamsSchema },
  )

export const api = new Elysia({ prefix: '/api' })
  // better-auth owns /api/auth/**: sign-up, sign-in, sign-out, session.
  .all('/auth/*', ({ request }) => auth.handler(request))
  .use(todoRoutes)

export type Api = typeof api
