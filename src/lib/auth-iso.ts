import { ensureSessionServer } from "@better-auth-ui/core/server";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "./auth";
import { authClient } from "./auth-client";
import { ensureSession } from "@better-auth-ui/core";
import type { QueryClient } from "@tanstack/react-query";

export const ensureSessionIso = createIsomorphicFn()
  .server((queryClient: QueryClient) =>
    ensureSessionServer(queryClient, auth, { headers: getRequestHeaders() })
  )
  .client((queryClient: QueryClient) => ensureSession(queryClient, authClient))
