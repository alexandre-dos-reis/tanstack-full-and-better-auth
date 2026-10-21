/**
 * Seeds two users with their own todos: bun run db:seed
 *
 * Users are created through better-auth's own API (so passwords are hashed the
 * way sign-in expects), and todos are inserted through `withUser` as the
 * RLS-constrained `todo_app` role — the same path the HTTP handlers take.
 */
import { eq } from "drizzle-orm";
import { authDb, withUser } from "~/db";
import { user } from "~/db/schema/auth";
import { todos } from "~/db/schema/todos";
import { auth } from "~/lib/auth";

const PASSWORD = "password1234";

const fixtures = [
  {
    email: "alice@example.com",
    name: "Alice",
    todos: ["Read the RLS policy in src/db/schema/todos.ts", "Ship the thing", "Water plants"],
  },
  {
    email: "bob@example.com",
    name: "Bob",
    todos: ["Try to read Alice’s todos", "Fail", "Accept the database’s verdict"],
  },
];

for (const fixture of fixtures) {
  let userId: string;

  try {
    const res = await auth.api.signUpEmail({
      body: { email: fixture.email, name: fixture.name, password: PASSWORD },
    });
    userId = res.user.id;
    console.log(`created ${fixture.email}`);
  } catch {
    const [existing] = await authDb
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, fixture.email));
    if (!existing) throw new Error(`could not create or find ${fixture.email}`);
    userId = existing.id;
    console.log(`reusing ${fixture.email}`);
  }

  await withUser(userId, async (tx) => {
    await tx.delete(todos); // RLS scopes this to *this* user's rows
    await tx.insert(todos).values(
      fixture.todos.map((title, i) => ({
        userId,
        title,
        // `now()` is transaction-stable, so a single multi-row insert would give
        // every row the same createdAt and leave the list order undefined.
        createdAt: new Date(Date.now() + i * 1000),
      })),
    );
  });
  console.log(`  seeded ${fixture.todos.length} todos`);
}

console.log(`\nboth accounts use the password: ${PASSWORD}`);
process.exit(0);
