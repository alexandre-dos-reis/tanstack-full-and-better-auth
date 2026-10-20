import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema',
  out: './drizzle',
  // Migrations run as the owner role; it owns the tables and the policies.
  dbCredentials: { url: process.env.DATABASE_URL_OWNER! },
  // The roles are created by devenv's postgres initialScript, not by drizzle-kit.
  // `.existing()` on the role + this flag keeps drizzle out of role management.
  entities: { roles: false },
  verbose: true,
  strict: true,
})
