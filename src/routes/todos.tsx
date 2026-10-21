import { Suspense, useState } from "react";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useLiveSuspenseQuery, Query, useDbClient } from "@tanstack/react-db";
import { AuthClient } from "~/lib/auth-client";
import { AuthIso } from "~/lib/auth-iso";
import { todosCollection } from "~/db/collections";

const todosQuery = new Query()
  .from({ todo: todosCollection })
  .orderBy(({ todo }) => todo.createdAt, "asc");

export const Route = createFileRoute("/todos")({
  beforeLoad: async ({ context }) => {
    const session = await AuthIso.ensureSession(context.queryClient);

    if (!session) {
      throw redirect({ to: "/login" });
    }

    return { user: session.user };
  },

  // Awaiting the preload in the loader makes the rows part of the critical SSR
  // payload: the HTML arrives with the list already rendered. Drop this and the
  // adapter streams the query result instead (the Suspense boundary below is
  // what makes that work).
  loader: async ({ context }) => {
    await context.dbClient.preloadLiveQuery({ query: todosQuery });
  },

  component: TodosPage,
});

function TodosPage() {
  const { user } = Route.useRouteContext();
  const router = useRouter();

  const { mutate: signOut } = AuthClient.useSignOut({
    onSettled: async () => {
      await router.navigate({ to: "/login" });
    },
  });

  return (
    <>
      <nav className="top">
        <div>
          <h1>Todos</h1>
          <span className="who">{user.email}</span>
        </div>
        <button className="ghost" onClick={() => signOut()}>
          Sign out
        </button>
      </nav>

      <Suspense fallback={<p className="empty">Loading todos…</p>}>
        <TodoList />
      </Suspense>
    </>
  );
}

function TodoList() {
  const { user } = Route.useRouteContext();

  const todos = useDbClient().collection(todosCollection);

  const { data } = useLiveSuspenseQuery({
    query: todosQuery,
  });
  const [title, setTitle] = useState("");

  const completed = data.filter((todo) => todo.completed);

  function add(e: React.ChangeEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    const now = new Date();
    // Optimistic insert. The collection's onInsert posts to /api/todos and
    // rolls this back if the server rejects it.
    todos.insert({
      id: crypto.randomUUID(),
      userId: user.id,
      title: trimmed,
      completed: false,
      createdAt: now,
      updatedAt: now,
    });
    setTitle("");
  }

  return (
    <>
      <form className="row" onSubmit={add}>
        <input
          type="text"
          value={title}
          placeholder="What needs doing?"
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
        />
        <button type="submit" disabled={!title.trim()}>
          Add
        </button>
      </form>

      <div className="card">
        {completed.length > 0 && (
          <div className="actions">
            {/* One multi-key delete => one optimistic transaction => one
                request => one Postgres transaction. All of them go, or none. */}
            <button className="ghost" onClick={() => todos.delete(completed.map((t) => t.id))}>
              Clear {completed.length} completed
            </button>
          </div>
        )}
        {data.length === 0 ? (
          <p className="empty">Nothing here yet.</p>
        ) : (
          <ul className="todos">
            {data.map((todo) => (
              <li key={todo.id} className={todo.completed ? "done" : undefined}>
                <input
                  type="checkbox"
                  checked={todo.completed}
                  aria-label={`Mark "${todo.title}" ${todo.completed ? "incomplete" : "complete"}`}
                  onChange={() =>
                    todos.update(todo.id, (draft) => {
                      draft.completed = !draft.completed;
                    })
                  }
                />
                <span className="title">{todo.title}</span>
                <button className="ghost" onClick={() => todos.delete(todo.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
