import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves this app from https://fabbarix.github.io/feeder-tc/ —
// base MUST stay "/feeder-tc/" (see HANDOVER.md §7). Routing is hash-based
// (createHashRouter) because Pages cannot rewrite paths for a client-side router.
export default defineConfig({
  base: "/feeder-tc/",
  plugins: [react()],
});
