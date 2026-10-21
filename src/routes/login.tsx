import { useState } from "react";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { AuthClient } from "~/lib/auth-client";
import { AuthIso } from "~/lib/auth-iso";

export const Route = createFileRoute("/login")({
  beforeLoad: async ({ context }) => {
    const session = await AuthIso.ensureSession(context.queryClient);

    if (session) {
      throw redirect({ to: "/todos" });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const context = Route.useRouteContext();
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);

  const { mutate: signInEmail, isPending: isPendingSignInEmail } = AuthClient.useSignInEmail({
    onError: (error) => setError(error.error.message),
    onSuccess: async () => {
      // The route guards read the session with `ensureQueryData`, which hands
      // back whatever is cached even once it is stale -- so the invalidation
      // the sign-in mutation triggers is not enough on its own: the cached
      // `null` from this page's own beforeLoad would send /todos right back
      // here. Write the real session into the cache before navigating.
      // `staleTime: 0` matters: the router's QueryClient defaults to 30s, and
      // fetchQuery honours that default, which would hand back the same stale
      // `null` instead of hitting the network.
      await AuthClient.prefetchSession(context.queryClient);
      await router.navigate({ to: "/todos" });
    },
  });

  const { mutate: signUpEmail, isPending: isPendingSignUpEmail } = AuthClient.useSignUpEmail({
    onError: (error) => setError(error.error.message),
    onSuccess: () => setMode("signin"),
  });

  const isPending = isPendingSignInEmail || isPendingSignUpEmail;

  function submit(e: React.ChangeEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "") || email.split("@")[0]!;

    setError(null);

    if (mode === "signin") {
      signInEmail({ email, password });
    } else {
      signUpEmail({ email, password, name });
    }
  }

  return (
    <>
      <h1>{mode === "signin" ? "Sign in" : "Create an account"}</h1>
      <p className="sub">
        Two accounts see two different todo lists — enforced by Postgres, not by the query code.
      </p>

      <div className="tabs">
        <button
          className={mode === "signin" ? "" : "ghost"}
          onClick={() => setMode("signin")}
          type="button"
        >
          Sign in
        </button>
        <button
          className={mode === "signup" ? "" : "ghost"}
          onClick={() => setMode("signup")}
          type="button"
        >
          Sign up
        </button>
      </div>

      <form className="card" onSubmit={submit}>
        {mode === "signup" && (
          <fieldset>
            <label htmlFor="name">Name</label>
            <input id="name" name="name" type="text" autoComplete="name" />
          </fieldset>
        )}
        <fieldset>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" />
        </fieldset>
        <fieldset>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
          />
        </fieldset>
        {error && <p className="err">{error}</p>}
        <button type="submit" disabled={isPending}>
          {isPending ? "…" : mode === "signin" ? "Sign in" : "Sign up"}
        </button>
      </form>
    </>
  );
}
