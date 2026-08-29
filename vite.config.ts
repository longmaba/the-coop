import { defineConfig } from "vite";

const SITES_LOCAL_DATABASE_ID = "00000000-0000-4000-8000-000000000000";

export default defineConfig(async ({ mode }) => {
  const plugins = [];
  if (mode === "sites") {
    const [{ cloudflare }, { sites }] = await Promise.all([
      import("@cloudflare/vite-plugin"),
      import("@openai/sites-vite-plugin"),
    ]);
    plugins.push(
      sites(),
      cloudflare({
        viteEnvironment: { name: "server" },
        config: {
          main: "worker/index.ts",
          compatibility_flags: ["nodejs_compat"],
          d1_databases: [
            {
              binding: "DB",
              database_name: "the-coop-rooms",
              database_id: SITES_LOCAL_DATABASE_ID,
            },
          ],
          assets: {
            binding: "ASSETS",
            not_found_handling: "single-page-application",
            run_worker_first: ["/api/*"],
          },
        },
      }),
    );
  }

  return {
    plugins,
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
    },
    build: {
      sourcemap: false,
    },
  };
});
