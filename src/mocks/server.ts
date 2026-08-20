import { setupServer } from "msw/node";
import { handlers } from "./handlers";

/** msw server for Vitest (Node environment). See vitest.setup.ts for lifecycle wiring. */
export const server = setupServer(...handlers);
