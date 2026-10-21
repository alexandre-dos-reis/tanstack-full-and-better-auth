/**
 * Production server: bun run build && bun run start
 *
 * The Start build emits a request handler (dist/server/server.js), not a
 * listening server, so this wires it to Bun.serve and serves the hashed client
 * assets from dist/client in front of it.
 */
import { file } from "bun";

type ServerEntry = {
  default: { fetch: (request: Request) => Response | Promise<Response> };
};

const port = Number(process.env.PORT ?? 3000);
const distDir = new URL("../dist/", import.meta.url);
const clientDir = new URL("client/", distDir);
const serverEntry = new URL("server/server.js", distDir);

if (!(await file(serverEntry).exists())) {
  console.error("dist/server/server.js is missing — run: bun run build");
  process.exit(1);
}

// Resolved at runtime on purpose: a build artifact has no type declarations, so
// a static import would only ever be `any`. The specifier is non-literal so
// TypeScript doesn't try to resolve it, and the shape is asserted above.
const entry = ((await import(serverEntry.href)) as ServerEntry).default;

async function staticAsset(pathname: string) {
  if (pathname === "/" || pathname.includes("..")) return null;
  const candidate = file(new URL(pathname.slice(1), clientDir));
  return (await candidate.exists()) ? candidate : null;
}

Bun.serve({
  port,
  idleTimeout: 30,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    const asset = await staticAsset(pathname);
    if (asset) {
      return new Response(asset, {
        headers: {
          // Vite fingerprints everything under /assets/.
          "cache-control": pathname.startsWith("/assets/")
            ? "public, max-age=31536000, immutable"
            : "public, max-age=0, must-revalidate",
        },
      });
    }
    return entry.fetch(request);
  },
});

console.log(`listening on http://localhost:${port}`);
