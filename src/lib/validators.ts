import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { z } from "zod";
import { todos } from "~/db/schema/todos";

/**
 * Every schema here is derived from the drizzle table definition, so the column
 * list, nullability and types stay in lockstep with the migration. Nothing
 * restates the shape of a todo by hand.
 */

/**
 * A todo, with `Date` timestamps.
 *
 * That holds on both sides of the wire: Elysia serializes Date to ISO-8601, and
 * Eden's treaty client revives ISO-8601 back into Date when it parses the
 * response. TanStack Start's SSR serializer preserves Date through
 * dehydration too, so the collection sees the same type everywhere.
 */
export const todoSchema = createSelectSchema(todos);
export type Todo = z.infer<typeof todoSchema>;

/**
 * Create input.
 *
 * `id` is optional and client-supplied: TanStack DB applies the insert
 * optimistically under a key it chose, so letting the client pick the uuid
 * keeps the optimistic row and the stored row on the same key. Omit it and the
 * column default fills one in.
 *
 * `user_id` is deliberately *not* accepted from the client — the handler takes
 * it from the session, and the RLS WITH CHECK clause is the backstop if that
 * ever regresses.
 */
export const todoCreateSchema = createInsertSchema(todos, {
  title: (s) => s.trim().min(1, "Title is required").max(200),
}).pick({ id: true, title: true });
export type TodoCreate = z.infer<typeof todoCreateSchema>;

/** Patch fields: all optional, server-controlled columns excluded. */
export const todoPatchSchema = createUpdateSchema(todos, {
  title: (s) => s.trim().min(1, "Title is required").max(200),
}).pick({ title: true, completed: true });

const hasSomeField = (v: Record<string, unknown>) => Object.values(v).some((x) => x !== undefined);

/** Body of `PATCH /api/todos/:id`. */
export const todoUpdateSchema = todoPatchSchema.refine(hasSomeField, {
  message: "Nothing to update",
});
export type TodoUpdate = z.infer<typeof todoUpdateSchema>;

/** One entry in a batch `update`: the same patch fields, plus which row. */
export const todoBatchUpdateSchema = todoPatchSchema
  .extend({ id: z.uuid() })
  .refine(({ id: _id, ...changes }) => hasSomeField(changes), {
    message: "Nothing to update",
  });

/**
 * Body of `POST /api/todos/batch` — the whole thing runs in one Postgres
 * transaction, so a failure anywhere leaves the list exactly as it was.
 */
export const todoBatchSchema = z
  .object({
    insert: z.array(todoCreateSchema).optional(),
    update: z.array(todoBatchUpdateSchema).optional(),
    delete: z.array(z.uuid()).optional(),
  })
  .refine((b) => (b.insert?.length ?? 0) + (b.update?.length ?? 0) + (b.delete?.length ?? 0) > 0, {
    message: "Batch is empty",
  });
export type TodoBatch = z.infer<typeof todoBatchSchema>;

export const todoParamsSchema = z.object({ id: z.uuid() });
