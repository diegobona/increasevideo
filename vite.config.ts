import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: [
    { find: /^@\/libs\/db$/, replacement: fileURLToPath(new URL("./src/libs/db/cloudflare.ts", import.meta.url)) },
    { find: /^@\/libs\/platform$/, replacement: fileURLToPath(new URL("./src/libs/db/cloudflare-platform.ts", import.meta.url)) },
  ] },
  plugins: [
    vinext(),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
