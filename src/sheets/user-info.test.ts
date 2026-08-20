import { describe, expect, it, vi } from "vitest";
import { fetchAuthenticatedUser } from "./user-info.ts";
import { SheetsHttpError } from "./errors.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("fetchAuthenticatedUser", () => {
  it("calls Drive's about.get with the bearer token and maps displayName/emailAddress/photoLink", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toContain("https://www.googleapis.com/drive/v3/about");
      expect(url).toContain("fields=user");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tok-abc");
      return jsonResponse({
        user: { displayName: "Fabio Torchetti", emailAddress: "fabbari@gmail.com", photoLink: "https://example.com/p.jpg" },
      });
    });

    const user = await fetchAuthenticatedUser("tok-abc", fetchImpl as unknown as typeof fetch);
    expect(user).toEqual({
      name: "Fabio Torchetti",
      email: "fabbari@gmail.com",
      pictureUrl: "https://example.com/p.jpg",
    });
  });

  it("never attaches an API key (invariant: the Picker key is never used on a Drive/Sheets REST call)", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(new URL(String(input)).searchParams.has("key")).toBe(false);
      return jsonResponse({ user: { emailAddress: "a@b.com" } });
    });
    await fetchAuthenticatedUser("tok", fetchImpl as unknown as typeof fetch);
  });

  it("falls back to the email as the display name when displayName is absent", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ user: { emailAddress: "a@b.com" } }));
    const user = await fetchAuthenticatedUser("tok", fetchImpl as unknown as typeof fetch);
    expect(user).toEqual({ name: "a@b.com", email: "a@b.com" });
  });

  it("omits pictureUrl (rather than undefined) when photoLink is absent", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ user: { emailAddress: "a@b.com", displayName: "A" } }));
    const user = await fetchAuthenticatedUser("tok", fetchImpl as unknown as typeof fetch);
    expect("pictureUrl" in user).toBe(false);
  });

  it("throws SheetsHttpError on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
    await expect(fetchAuthenticatedUser("tok", fetchImpl as unknown as typeof fetch)).rejects.toThrow(SheetsHttpError);
  });

  it("throws when the response is missing emailAddress", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ user: {} }));
    await expect(fetchAuthenticatedUser("tok", fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      /emailAddress/,
    );
  });
});
