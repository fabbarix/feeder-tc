import { describe, expect, it } from "vitest";
import {
  clearImportHistory,
  formatDiagnosticForClipboard,
  MAX_IMPORT_HISTORY,
  readImportHistory,
  readJpegDimensionsFromBase64,
  recordImportAttempt,
  redactHeaders,
  summarizeImagePart,
  summarizeRequestBody,
  truncateForDiagnostic,
  finalizeDiagnostic,
  type RecipeImportDiagnostic,
} from "./diagnostics.ts";

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe("redactHeaders", () => {
  it("replaces the Authorization value, never leaking the key itself", () => {
    const out = redactHeaders({ "Content-Type": "application/json", Authorization: "Bearer sk-super-secret-value" });
    expect(out.Authorization).toBe("[redacted]");
    expect(JSON.stringify(out)).not.toContain("sk-super-secret-value");
    expect(out["Content-Type"]).toBe("application/json");
  });

  it("catches differently-cased or credential-shaped header names too", () => {
    const out = redactHeaders({ authorization: "Bearer x", "X-Api-Key": "y", "some-secret": "z", Other: "fine" });
    expect(out.authorization).toBe("[redacted]");
    expect(out["X-Api-Key"]).toBe("[redacted]");
    expect(out["some-secret"]).toBe("[redacted]");
    expect(out.Other).toBe("fine");
  });
});

describe("truncateForDiagnostic", () => {
  it("leaves short text untouched", () => {
    expect(truncateForDiagnostic("hello", 100)).toBe("hello");
  });

  it("truncates long text with an explicit marker, never silently", () => {
    const long = "x".repeat(50);
    const result = truncateForDiagnostic(long, 10);
    expect(result.startsWith("x".repeat(10))).toBe(true);
    expect(result).toMatch(/truncated/i);
    expect(result.length).toBeLessThan(long.length + 60);
  });
});

const ONE_BY_ONE_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=";

describe("readJpegDimensionsFromBase64", () => {
  it("reads width/height straight out of a real JPEG's SOF marker", () => {
    const dims = readJpegDimensionsFromBase64(ONE_BY_ONE_JPEG_BASE64);
    expect(dims).toEqual({ width: 1, height: 1 });
  });

  it("degrades to undefined for garbage input rather than throwing", () => {
    expect(readJpegDimensionsFromBase64("not-base64-at-all!!!")).toBeUndefined();
    expect(readJpegDimensionsFromBase64("AAAA")).toBeUndefined();
  });
});

describe("summarizeImagePart", () => {
  it("never returns the payload itself, only a size (and dimensions, when readable)", () => {
    const dataUrl = `data:image/jpeg;base64,${ONE_BY_ONE_JPEG_BASE64}`;
    const summary = summarizeImagePart(dataUrl);
    expect(summary.type).toBe("image");
    expect(summary.approxKB).toBeGreaterThan(0);
    expect(summary.dimensions).toBe("1×1px");
    expect(JSON.stringify(summary)).not.toContain(ONE_BY_ONE_JPEG_BASE64);
  });
});

describe("summarizeRequestBody", () => {
  it("replaces every embedded image data URL, anywhere in the structure, and truncates other long strings", () => {
    const dataUrl = `data:image/jpeg;base64,${ONE_BY_ONE_JPEG_BASE64}`;
    const body = {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "x".repeat(5000) },
        {
          role: "user",
          content: [
            { type: "text", text: "Transcribe this recipe." },
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          ],
        },
      ],
    };
    const summarized = summarizeRequestBody(body) as {
      messages: { role: string; content: string | { type: string; image_url?: { url: unknown } }[] }[];
    };
    const serialized = JSON.stringify(summarized);
    expect(serialized).not.toContain(ONE_BY_ONE_JPEG_BASE64);
    expect(serialized.length).toBeLessThan(JSON.stringify(body).length);
    const userContent = summarized.messages[1]!.content as { type: string; image_url?: { url: unknown } }[];
    expect(userContent[1]!.image_url!.url).toEqual({ type: "image", approxKB: expect.any(Number), dimensions: "1×1px" });
    expect(userContent[2]!.image_url!.url).toEqual({ type: "image", approxKB: expect.any(Number), dimensions: "1×1px" });
  });

  it("leaves an all-text body essentially untouched (below the truncation floor)", () => {
    const body = { messages: [{ role: "user", content: "Garlic Rice\n2 cloves garlic" }] };
    expect(summarizeRequestBody(body)).toEqual(body);
  });
});

describe("formatDiagnosticForClipboard", () => {
  function baseDiagnostic(overrides: Partial<RecipeImportDiagnostic> = {}): RecipeImportDiagnostic {
    return finalizeDiagnostic({
      outcome: "error",
      startedAtMs: 1000,
      now: 4500,
      request: {
        url: "https://mock.test/v1/chat/completions",
        method: "POST",
        model: "gpt-4o-mini",
        headers: redactHeaders({ Authorization: "Bearer sk-should-never-appear", "Content-Type": "application/json" }),
        body: { hello: "world" },
      },
      httpStatus: 401,
      httpStatusText: "Unauthorized",
      responseBodyText: "unauthorized",
      cause: "bad-status",
      ...overrides,
    });
  }

  it("never contains the API key, under any failure path", () => {
    const text = formatDiagnosticForClipboard(baseDiagnostic());
    expect(text).not.toContain("sk-should-never-appear");
    expect(text).toContain("[redacted]");
  });

  it("reads as plain, greppable text carrying the address, status, cause and elapsed time", () => {
    const text = formatDiagnosticForClipboard(baseDiagnostic());
    expect(text).toContain("https://mock.test/v1/chat/completions");
    expect(text).toContain("401");
    expect(text).toContain("3.5s");
    expect(text).toMatch(/unexpected status/i);
  });
});

describe("import history (localStorage)", () => {
  function diag(n: number): RecipeImportDiagnostic {
    return finalizeDiagnostic({
      outcome: "error",
      startedAtMs: n,
      now: n + 100,
      request: { url: "https://mock.test/v1/chat/completions", method: "POST", model: "gpt-4o-mini", headers: {}, body: {} },
    });
  }

  it("is empty until something is recorded, and clearable", () => {
    const storage = fakeStorage();
    expect(readImportHistory(storage)).toEqual([]);
    recordImportAttempt(diag(1), storage);
    expect(readImportHistory(storage)).toHaveLength(1);
    clearImportHistory(storage);
    expect(readImportHistory(storage)).toEqual([]);
  });

  it("caps at MAX_IMPORT_HISTORY, newest first, never growing unbounded", () => {
    const storage = fakeStorage();
    for (let i = 0; i < MAX_IMPORT_HISTORY + 5; i += 1) {
      recordImportAttempt(diag(i), storage);
    }
    const history = readImportHistory(storage);
    expect(history).toHaveLength(MAX_IMPORT_HISTORY);
    // Newest attempt (highest startedAtMs) is first.
    expect(history[0]!.startedAt).toBe(new Date(MAX_IMPORT_HISTORY + 4).toISOString());
  });

  it("degrades to empty on a corrupted value, rather than throwing", () => {
    const storage = fakeStorage();
    storage.setItem("feeder.recipeImport.diagnosticHistory.v1", "{not json");
    expect(readImportHistory(storage)).toEqual([]);
    storage.setItem("feeder.recipeImport.diagnosticHistory.v1", JSON.stringify([{ garbage: true }]));
    expect(readImportHistory(storage)).toEqual([]);
  });
});
