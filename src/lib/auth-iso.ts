import { ensureSessionServer, prefetchSessionServer } from "@better-auth-ui/core/server";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "./auth";
import { AuthClient } from "./auth-client";
import type { QueryClient } from "@tanstack/react-query";

export namespace AuthIso {
  /**
   * Get the current session from the query cache, calling `fetchSession` under
   * the hood if no cached entry exists. Resolves with the session data, making
   * it ideal for loaders or `beforeLoad` guards.
   */
  export const ensureSession = createIsomorphicFn()
    .server((queryClient: QueryClient) =>
      ensureSessionServer(queryClient, auth, { headers: getRequestHeaders() }),
    )
    .client((queryClient: QueryClient) => AuthClient.ensureSession(queryClient));

  /**
   * Prefetch the current session into the query cache. Behaves like
   * `fetchSession`, but does not throw on error and does not return the data —
   * use this to warm the cache without blocking navigation.
   *
   * This pattern can prepare a public route that later shows an authenticated widget.
   * */
  export const prefetchSession = createIsomorphicFn()
    .server((queryClient: QueryClient) =>
      prefetchSessionServer(queryClient, auth, { headers: getRequestHeaders() }),
    )
    .client((queryClient: QueryClient) => AuthClient.prefetchSession(queryClient));
}
