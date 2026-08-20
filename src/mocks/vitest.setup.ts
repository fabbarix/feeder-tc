import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./server";

// Any unit/BDD test that performs an HTTP call must go through a mocked
// handler — an unhandled request throws instead of hitting the network.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
