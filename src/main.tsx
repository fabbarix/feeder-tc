import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";

async function enableMocksIfRequested(): Promise<void> {
  // Read import.meta.env directly rather than via env.mocksEnabled. Vite
  // substitutes this expression with a literal at build time, so with mocks
  // off the whole branch is statically dead and the msw chunk (~400 kB) is
  // dropped from the bundle entirely. Behind a getter it is opaque to the
  // optimiser and ships to Pages as a dead asset — which WP-24's service
  // worker would then precache. Keep this check inline.
  if (import.meta.env.VITE_ENABLE_MOCKS !== "true") return;
  const { worker } = await import("./mocks/browser");
  await worker.start({
    onUnhandledRequest: "bypass",
    // BASE_URL mirrors vite.config.ts's `base` ("/feeder-tc/" in production,
    // "/" in dev unless overridden); the worker script is a public/ asset,
    // so it's served under that same prefix, not at the origin root.
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
  });
}

async function bootstrap(): Promise<void> {
  await enableMocksIfRequested();

  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error('Missing "#root" element in index.html.');

  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
