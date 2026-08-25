import { describe, expect, it } from "vitest";
import {
  classifySourceVerification,
  compareImportedUrls,
  describeSourceVerificationForReview,
  extractResponsesProvenance,
} from "./source-verification.ts";

const REQUESTED = "https://ricette.giallozafferano.it/Spaghetti-alla-Norma.html";

/**
 * The owner's real reply (2026-08-25 report): a `web_search_call` action
 * searching for the recipe, with five candidate pages including two
 * differently-named near misses, followed by an assistant message whose
 * `url_citation` annotation names the exact page requested. This must
 * classify as `"confirmed"` — it did in fact read the right page — even
 * though a search happened along the way. A false warning here would be
 * exactly the noise problem the whole feature exists to avoid.
 */
const OWNER_EVIDENCE_REPLY = {
  status: "completed",
  output: [
    {
      type: "web_search_call",
      id: "ws_1",
      status: "completed",
      action: {
        type: "search",
        query: "Spaghetti alla Norma recipe site:ricette.giallozafferano.it",
        sources: [
          { url: "https://ricette.giallozafferano.it/Spaghetti-alla-Norma.html" },
          { url: "https://ricette.giallozafferano.it/Pasta-alla-Norma-in-bianco.html" },
          { url: "https://ricette.giallozafferano.it/Pasta-alla-Norma-leggera.html" },
          { url: "https://ricette.giallozafferano.it/Pasta-alla-Norma.html" },
          { url: "https://www.giallozafferano.it/ricette-cat/Pasta/" },
        ],
      },
    },
    {
      type: "message",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: "{...recipe json...}",
          annotations: [
            {
              type: "url_citation",
              url: "https://ricette.giallozafferano.it/Spaghetti-alla-Norma.html",
              title: "Spaghetti alla Norma",
              start_index: 0,
              end_index: 1,
            },
          ],
        },
      ],
    },
  ],
};

describe("extractResponsesProvenance", () => {
  it("reads the owner's real evidence reply — one search action with its candidates, one citation", () => {
    const provenance = extractResponsesProvenance(OWNER_EVIDENCE_REPLY);
    expect(provenance.toolActions).toEqual([
      {
        type: "search",
        query: "Spaghetti alla Norma recipe site:ricette.giallozafferano.it",
        sources: [
          "https://ricette.giallozafferano.it/Spaghetti-alla-Norma.html",
          "https://ricette.giallozafferano.it/Pasta-alla-Norma-in-bianco.html",
          "https://ricette.giallozafferano.it/Pasta-alla-Norma-leggera.html",
          "https://ricette.giallozafferano.it/Pasta-alla-Norma.html",
          "https://www.giallozafferano.it/ricette-cat/Pasta/",
        ],
      },
    ]);
    expect(provenance.citedUrls).toEqual(["https://ricette.giallozafferano.it/Spaghetti-alla-Norma.html"]);
  });

  it("comes back empty, not throwing, when the reply carries no output array at all", () => {
    expect(extractResponsesProvenance({ status: "completed", output_text: "{}" })).toEqual({ toolActions: [], citedUrls: [] });
  });

  it("comes back empty for a non-object reply", () => {
    expect(extractResponsesProvenance(null)).toEqual({ toolActions: [], citedUrls: [] });
    expect(extractResponsesProvenance("not json")).toEqual({ toolActions: [], citedUrls: [] });
  });

  it("reads an 'open' action with no sources", () => {
    const provenance = extractResponsesProvenance({
      output: [{ type: "web_search_call", action: { type: "open" } }],
    });
    expect(provenance.toolActions).toEqual([{ type: "open" }]);
  });
});

describe("classifySourceVerification — the owner's real evidence", () => {
  it("classifies as confirmed, even though a search happened along the way", () => {
    const provenance = extractResponsesProvenance(OWNER_EVIDENCE_REPLY);
    expect(classifySourceVerification(REQUESTED, provenance)).toEqual({
      status: "confirmed",
      citedUrl: "https://ricette.giallozafferano.it/Spaghetti-alla-Norma.html",
    });
  });
});

describe("compareImportedUrls — near misses that must NOT warn", () => {
  it.each([
    ["a trailing slash", "https://example.com/recipe", "https://example.com/recipe/"],
    ["www. vs bare host", "https://example.com/recipe", "https://www.example.com/recipe"],
    ["http vs https", "http://example.com/recipe", "https://example.com/recipe"],
    ["an added utm_source", "https://example.com/recipe", "https://example.com/recipe?utm_source=newsletter"],
    ["an added fbclid", "https://example.com/recipe", "https://example.com/recipe?fbclid=abc123"],
    ["host case", "https://Example.com/recipe", "https://example.com/recipe"],
    ["both a scheme and a trailing-slash difference at once", "http://example.com/recipe", "https://www.example.com/recipe/"],
  ])("%s counts as the same page", (_label, requested, cited) => {
    expect(compareImportedUrls(requested, cited)).toBe("same-page");
  });
});

describe("compareImportedUrls — differences that MUST warn", () => {
  it("a different path on the same host is 'same-site', not 'same-page'", () => {
    expect(compareImportedUrls("https://example.com/spaghetti-alla-norma", "https://example.com/pasta-alla-norma-leggera")).toBe(
      "same-site",
    );
  });

  it("a different host entirely is 'different-site'", () => {
    expect(compareImportedUrls("https://ricette.giallozafferano.it/Spaghetti-alla-Norma.html", "https://cookpad.com/us/recipes/12345")).toBe(
      "different-site",
    );
  });
});

describe("classifySourceVerification — each outcome, independent of the fixture", () => {
  it("confirmed: a citation matches after tolerant normalization", () => {
    const result = classifySourceVerification("https://example.com/recipe", {
      toolActions: [],
      citedUrls: ["https://www.example.com/recipe/?utm_source=x"],
    });
    expect(result.status).toBe("confirmed");
  });

  it("different-page: every citation is the same host, different path", () => {
    const result = classifySourceVerification("https://ricette.giallozafferano.it/Spaghetti-alla-Norma.html", {
      toolActions: [],
      citedUrls: ["https://ricette.giallozafferano.it/Pasta-alla-Norma-leggera.html"],
    });
    expect(result).toEqual({ status: "different-page", citedUrl: "https://ricette.giallozafferano.it/Pasta-alla-Norma-leggera.html" });
  });

  it("different-site: the citation is on a different host", () => {
    const result = classifySourceVerification("https://ricette.giallozafferano.it/Spaghetti-alla-Norma.html", {
      toolActions: [],
      citedUrls: ["https://cookpad.com/us/recipes/12345"],
    });
    expect(result).toEqual({ status: "different-site", citedUrl: "https://cookpad.com/us/recipes/12345" });
  });

  it("unconfirmed: no citations at all — a search happened, but nothing says what was read", () => {
    const result = classifySourceVerification("https://example.com/recipe", {
      toolActions: [{ type: "search", query: "recipe", sources: ["https://example.com/recipe"] }],
      citedUrls: [],
    });
    expect(result).toEqual({ status: "unconfirmed" });
  });

  it("unconfirmed: no provenance reported at all", () => {
    expect(classifySourceVerification("https://example.com/recipe", { toolActions: [], citedUrls: [] })).toEqual({
      status: "unconfirmed",
    });
  });

  it("unconfirmed: a cited URL that isn't parseable is treated as inconclusive, not a mismatch", () => {
    const result = classifySourceVerification("https://example.com/recipe", { toolActions: [], citedUrls: ["not a url"] });
    expect(result).toEqual({ status: "unconfirmed" });
  });
});

const JARGON_PATTERN = /url_citation|web_search_call|annotation/i;

describe("describeSourceVerificationForReview — the review-screen copy", () => {
  it("says nothing at all for a confirmed import", () => {
    expect(describeSourceVerificationForReview({ status: "confirmed", citedUrl: "https://example.com/recipe" }, "https://example.com/recipe")).toBeUndefined();
  });

  it("is a quiet, non-alarming note when nothing could be confirmed either way", () => {
    const notice = describeSourceVerificationForReview({ status: "unconfirmed" }, "https://example.com/recipe");
    expect(notice?.tone).toBe("quiet");
    expect(notice?.text).not.toMatch(JARGON_PATTERN);
  });

  it("names both addresses, plainly, for a different page on the same site", () => {
    const notice = describeSourceVerificationForReview(
      { status: "different-page", citedUrl: "https://ricette.giallozafferano.it/Pasta-alla-Norma-leggera.html" },
      "https://ricette.giallozafferano.it/Spaghetti-alla-Norma.html",
    );
    expect(notice?.tone).toBe("warning");
    expect(notice?.text).toContain("https://ricette.giallozafferano.it/Spaghetti-alla-Norma.html");
    expect(notice?.text).toContain("https://ricette.giallozafferano.it/Pasta-alla-Norma-leggera.html");
    expect(notice?.text).not.toMatch(JARGON_PATTERN);
  });

  it("names both addresses, plainly, for a different website entirely", () => {
    const notice = describeSourceVerificationForReview(
      { status: "different-site", citedUrl: "https://cookpad.com/us/recipes/12345" },
      "https://ricette.giallozafferano.it/Spaghetti-alla-Norma.html",
    );
    expect(notice?.tone).toBe("warning");
    expect(notice?.text).toContain("https://ricette.giallozafferano.it/Spaghetti-alla-Norma.html");
    expect(notice?.text).toContain("https://cookpad.com/us/recipes/12345");
    expect(notice?.text).not.toMatch(JARGON_PATTERN);
  });

  it("never mentions internal API vocabulary in any of its notices", () => {
    const cases = [
      { status: "unconfirmed" as const },
      { status: "different-page" as const, citedUrl: "https://example.com/other" },
      { status: "different-site" as const, citedUrl: "https://other.example/recipe" },
    ];
    for (const verification of cases) {
      const notice = describeSourceVerificationForReview(verification, "https://example.com/recipe");
      expect(notice?.text ?? "").not.toMatch(/\bAPI\b|endpoint|schema|token/i);
    }
  });
});
