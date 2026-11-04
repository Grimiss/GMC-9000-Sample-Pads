import { defineConfig } from "vite";

// Keep local development at /; GitHub Actions supplies the repository prefix.
export default defineConfig({
  base: process.env.GITHUB_PAGES_BASE || "/",
});
