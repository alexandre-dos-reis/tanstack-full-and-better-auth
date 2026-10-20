import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { authDb, authSchema } from '~/db'

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  // Elysia mounts the handler at /api/auth/* (see src/server/api.ts).
  basePath: '/api/auth',
  database: drizzleAdapter(authDb, {
    provider: 'pg',
    schema: authSchema,
  }),
  emailAndPassword: {
    enabled: true,
    // Dev convenience: no mail transport wired up in this sample.
    requireEmailVerification: false,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 },
  },
})

export type Session = typeof auth.$Infer.Session
