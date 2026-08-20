import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { env } from "./env";

async function enableMocksIfRequested(): Promise<void> {
  if (!env.mocksEnabled) return;
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
