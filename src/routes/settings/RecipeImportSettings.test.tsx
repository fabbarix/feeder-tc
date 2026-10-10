import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecipeImportSettings } from "./RecipeImportSettings.tsx";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("RecipeImportSettings", () => {
  it("is folded behind a summary that says it isn't set up yet", async () => {
    const user = userEvent.setup();
    render(<RecipeImportSettings />);
    expect(screen.getByText(/not set up/i)).toBeVisible();
    expect(screen.getByLabelText("The address to send recipes to")).not.toBeVisible();

    await user.click(screen.getByText("Recipe reader"));
    expect(screen.getByLabelText("The address to send recipes to")).toBeVisible();
  });

  it("says it is on, and how many a day, once an address and password are saved", async () => {
    const user = userEvent.setup();
    render(<RecipeImportSettings />);
    await user.click(screen.getByText("Recipe reader"));
    await user.type(
      screen.getByLabelText("The address to send recipes to"),
      "https://example.test/v1",
    );
    await user.type(screen.getByLabelText("The password for that address"), "k");
    expect(screen.getByText(/^On · up to \d+ a day$/)).toBeInTheDocument();
  });

  it("opens and scrolls into view when the import screen links to it", () => {
    // jsdom has no layout, so no scrollIntoView of its own.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    window.history.replaceState(null, "", "/settings#recipe-reader");
    render(<RecipeImportSettings />);
    expect(screen.getByLabelText("The address to send recipes to")).toBeVisible();
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
