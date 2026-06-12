import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const apiPort = process.env.FACTORY_API_PORT ?? "8787";

export default defineConfig({
  plugins: [svelte()],
  root: "src/ui",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`
    }
  },
  build: {
    outDir: "../../dist/ui",
    emptyOutDir: true
  }
});
