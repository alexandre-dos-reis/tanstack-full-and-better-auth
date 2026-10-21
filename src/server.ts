import {
  createServerEntry,
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { api } from "~/server/api";

const startHandler = createStartHandler(defaultStreamHandler);

/**
 * Custom server entry: Elysia owns /api/**, TanStack Start owns everything else
 * (SSR, server functions, assets).
 */
export default createServerEntry({
  fetch(request, opts) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return api.handle(request);
    }
    return startHandler(request, opts);
  },
});
