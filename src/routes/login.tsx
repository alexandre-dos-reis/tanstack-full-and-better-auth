import { useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { authClient } from '~/lib/auth-client'
import { authQueryKeys, sessionQueryOptions } from '~/lib/session'

export const Route = createFileRoute('/login')({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.query(await sessionQueryOptions())
    if (session) throw redirect({ to: '/todos' })
  },
  component: LoginPage,
})

function LoginPage() {
  const { queryClient } = Route.useRouteContext()
  const router = useRouter()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.ChangeEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const email = String(form.get('email') ?? '')
    const password = String(form.get('password') ?? '')
    const name = String(form.get('name') ?? '') || email.split('@')[0]!

    setPending(true)
    setError(null)
    const res =
      mode === 'signin'
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name })
    setPending(false)

    if (res.error) {
      setError(res.error.message ?? 'Something went wrong')
      return
    }

    // `queryClient.query()` honours staleTime, and this page's own guard just
    // cached a "signed out" session — so without removing that entry the
    // /todos guard would read it and bounce us straight back here. Removing
    // rather than invalidating keeps this correct whichever read API the guard
    // uses (`ensureQueryData` returns cached data even when stale).
    queryClient.removeQueries({ queryKey: authQueryKeys.session })
    await router.invalidate()
    await router.navigate({ to: '/todos' })
  }

  return (
    <>
      <h1>{mode === 'signin' ? 'Sign in' : 'Create an account'}</h1>
      <p className="sub">
        Two accounts see two different todo lists — enforced by Postgres, not by
        the query code.
      </p>

      <div className="tabs">
        <button
          className={mode === 'signin' ? '' : 'ghost'}
          onClick={() => setMode('signin')}
          type="button"
        >
          Sign in
        </button>
        <button
          className={mode === 'signup' ? '' : 'ghost'}
          onClick={() => setMode('signup')}
          type="button"
        >
          Sign up
        </button>
      </div>

      <form className="card" onSubmit={submit}>
        {mode === 'signup' && (
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
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          />
        </fieldset>
        {error && <p className="err">{error}</p>}
        <button type="submit" disabled={pending}>
          {pending ? '…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
        </button>
      </form>
    </>
  )
}
