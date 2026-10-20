import { treaty } from '@elysiajs/eden'
import { createIsomorphicFn } from '@tanstack/react-start'
import type { Api } from './api'

/**
 * One typed Eden client, two transports.
 *
 * In the browser it is an ordinary `fetch` to our own origin, with cookies.
 *
 * During SSR it hands the Request straight to the Elysia app in-process
 * (`fetcher`) instead of making a loopback HTTP call, and forwards the incoming
 * `cookie` header so better-auth resolves the same session the browser has.
 * Both server-only modules are imported dynamically so the Start plugin can
 * strip this branch — and the pg/drizzle graph behind it — from the client
 * bundle.
 */
const createClient = createIsomorphicFn()
  .client(() =>
    treaty<Api>(window.location.origin, {
      fetch: { credentials: 'same-origin' },
    }),
  )
  .server(async () => {
    const [{ getRequest }, { api }] = await Promise.all([
      import('@tanstack/react-start/server'),
      import('./api'),
    ])
    const incoming = getRequest()
    const cookie = incoming.headers.get('cookie')
    return treaty<Api>(new URL(incoming.url).origin, {
      headers: cookie ? { cookie } : {},
      // Cast: Eden types `fetcher` as the full `typeof fetch` (including
      // `fetch.preconnect`), but only ever calls it as a plain function.
      fetcher: ((input: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve(api.handle(new Request(input, init)))) as typeof fetch,
    })
  })

export async function apiClient() {
  return await createClient()
}

/** Eden returns `{ data, error }`; collections and loaders want a throw. */
export function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) {
    const err = res.error as { status?: number; value?: unknown }
    const detail =
      typeof err.value === 'object' && err.value && 'error' in err.value
        ? String((err.value as { error: unknown }).error)
        : JSON.stringify(err.value ?? err)
    throw new Error(`API error${err.status ? ` ${err.status}` : ''}: ${detail}`)
  }
  return res.data as T
}
