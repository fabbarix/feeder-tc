import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The one shared tiny fixture image every photo-upload spec uses (originally `e2e/wp-photo-ui.spec.ts`'s own constant) — one file on disk, not a per-spec copy. */
export const TINY_PHOTO_PATH = path.join(__dirname, "fixtures/tiny.png");
