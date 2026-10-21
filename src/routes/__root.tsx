/// <reference types="vite/client" />
import type { QueryClient } from "@tanstack/react-query";
import type { DbClient } from "@tanstack/react-db";
import { HeadContent, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import appCss from "~/styles.css?url";

export interface RouterContext {
  queryClient: QueryClient;
  dbClient: DbClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Todos · RLS demo" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <main>{children}</main>
        <Scripts />
      </body>
    </html>
  );
}
