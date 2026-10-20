import { QueryClient } from '@tanstack/react-query'
import { DbClient } from '@tanstack/react-db'
import { createRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { routerWithDbClient } from '@tanstack/react-router-with-db'
import { createCollections } from '~/db/collections'
import { routeTree } from './routeTree.gen'

/**
 * Runs once per SSR request and once in the browser, so the QueryClient, the
 * DbClient and the collections are all request-scoped for free. That is the
 * whole trick to making TanStack DB safe under SSR with per-user data: nothing
 * materialized here outlives the request.
 */
export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000 } },
  })

  // Registering the QueryClient as a DbClient dependency lets first-party
  // adapters (query-db-collection) pick up the per-request client themselves.
  const dbClient = new DbClient({ queryClient })
  const collections = createCollections(queryClient)

  const router = createRouter({
    routeTree,
    context: { queryClient, dbClient, collections },
    defaultPreload: 'intent',
    // Let Query/DB own caching rather than the router.
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  })

  // Must come after createRouter: it subscribes to router events to
  // dehydrate/hydrate around each navigation.
  setupRouterSsrQueryIntegration({ router, queryClient })

  // Adds dbClient to context, wraps the app in DbProvider, dehydrates critical
  // state and streams queries discovered later in the render.
  return routerWithDbClient(router, dbClient)
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
