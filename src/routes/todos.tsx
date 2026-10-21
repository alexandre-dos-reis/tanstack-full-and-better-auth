import { Suspense, useState } from "react";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useLiveSuspenseQuery, Query } from "@tanstack/react-db";
import { AuthClient } from "~/lib/auth-client";
import { AuthIso } from "~/lib/auth-iso";
import { todosCollection } from "~/db/collections";

const todosQuery = {
  query: new Query().from({ todo: todosCollection }).orderBy(({ todo }) => todo.createdAt, "asc"),
};

export const Route = createFileRoute("/todos")({
  beforeLoad: async ({ context }) => {
    const session = await AuthIso.ensureSession(context.queryClient);

    if (!session) {
      throw redirect({ to: "/login" });
    }

    return { user: session.user };
  },

  // Awaiting the preload is what decides whether the rows are part of the
  // critical SSR payload or arrive after it. Both shapes are visible in the
  // served HTML:
  //
  //   awaited   => blocking.  <ul class="todos"> sits inline in the shell, the
  //                live query is dehydrated with its `snapshot`, and nothing
  //                follows the $tsr-stream-boundary marker.
  //   unawaited => streaming. The shell carries <!--$?--> plus the
  //                "Loading todos…" fallback, the live query is dehydrated as a
  //                pending `promise`, and the rows arrive later in a
  //                <div hidden id="S:0"> that React splices in via $RC.
  //
  // Unawaited still registers the live query *here*, so it makes the critical
  // dehydration cutoff and rides along as a promise resolved by a later inline
  // script — no extra round-trip. Removing the call entirely registers the live
  // query during render instead, which pushes the snapshot through dbStream
  // chunks: a third byte layout, same end state on the client.
  loader: ({ context }) => {
    context.dbClient.preloadLiveQuery(todosQuery);
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
  const { user, dbClient } = Route.useRouteContext();

  const todos = dbClient.collection(todosCollection);

  // The hook does not pick streaming vs blocking — the loader's `await` does.
  // What it picks is the not-ready behaviour, which only shows up when the
  // loader is unawaited:
  //
  //   useLiveSuspenseQuery => suspends, so React streams the real rows into the
  //                           Suspense boundary above.
  //   useLiveQuery         => returns data: [] right away, so the server ships
  //                           "Nothing here yet." and the rows appear only after
  //                           hydration. That is not blocking; it is an HTML
  //                           document asserting something false. Gate on
  //                           `isLoading` if you want this path.
  //
  // With the loader awaited the data is already in the collection, so both
  // hooks render identical markup and Suspense never engages.
  const { data } = useLiveSuspenseQuery(todosQuery);
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
