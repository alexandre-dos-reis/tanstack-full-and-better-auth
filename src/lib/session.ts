import { authQueryKeys, sessionOptions } from '@better-auth-ui/core'
import { createIsomorphicFn } from '@tanstack/react-start'
import { authClient } from '~/lib/auth-client'

export { authQueryKeys }

/**
 * Session query options from @better-auth-ui/core, with the right transport on
 * each side of the wire.
 *
 * Both halves use the same query key (`['auth', 'getSession']`), which is the
 * point: what SSR resolved hydrates straight into the client's cache.
 *
 * - On the server, `sessionOptionsServer` calls `auth.api.getSession` in
 *   process with the request's own headers. No HTTP hop, and no cookie
 *   forwarding to get wrong.
 * - In the browser, `sessionOptions` goes through the better-auth client to
 *   /api/auth/get-session.
 *
 * `staleTime: 0` deliberately overrides the router's global 30s default: a
 * guard that trusts a cached answer is exactly how you get bounced back to
 * /login immediately after signing in. better-auth's `session.cookieCache`
 * keeps the call cheap.
 */
const buildSessionOptions = createIsomorphicFn()
  .client(() => ({ ...sessionOptions(authClient), staleTime: 0 }))
  .server(async () => {
    const [{ getRequest }, { sessionOptionsServer }, { auth }] = await Promise.all([
      import('@tanstack/react-start/server'),
      import('@better-auth-ui/core/server'),
      import('~/lib/auth'),
    ])
    return {
      ...sessionOptionsServer(auth, { headers: getRequest().headers }),
      staleTime: 0,
    }
  })

export async function sessionQueryOptions() {
  return await buildSessionOptions()
}
