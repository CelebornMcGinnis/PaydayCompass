import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // amazon-cognito-identity-js pulls in Node's `buffer` package, which
  // references the global `global` object - production builds (Rollup)
  // happen to tolerate this, but Vite's dev-server dependency
  // pre-bundling (esbuild) doesn't define it at all, so any page that
  // touches Cognito (which is most of the app) crashes outright under
  // `npm run dev` with "ReferenceError: global is not defined" - this
  // never showed up before since prior verification only ever exercised
  // `npm run build`, never the dev server itself.
  define: {
    global: "globalThis",
  },
  server: {
    port: 5173,
  },
});
