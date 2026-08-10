import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 3000,
    open: true
  },
  build: {
    outDir: "dist"
  }
});
