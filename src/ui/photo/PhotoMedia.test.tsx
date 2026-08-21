import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { PhotoMedia } from "./PhotoMedia.tsx";

describe("PhotoMedia", () => {
  it("never calls fetchPhoto when hasPhoto is not true — the zero-photo default costs no round trip", () => {
    const fetchPhoto = vi.fn().mockResolvedValue("data:image/webp;base64,AAAA");
    const { container } = render(<PhotoMedia kind="ingredient" hasPhoto={false} size="list" fetchPhoto={fetchPhoto} />);
    expect(fetchPhoto).not.toHaveBeenCalled();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("shows a loading skeleton then the photo once fetchPhoto resolves", async () => {
    let resolveFetch: (url: string) => void = () => undefined;
    const fetchPhoto = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    render(<PhotoMedia kind="recipe" hasPhoto size="grid" fetchPhoto={fetchPhoto} alt="Chili" />);
    expect(fetchPhoto).toHaveBeenCalledOnce();
    expect(screen.getByRole("status", { name: "Photo loading" })).toBeInTheDocument();

    resolveFetch("data:image/webp;base64,AAAA");
    const img = await screen.findByAltText("Chili");
    expect(img).toHaveAttribute("src", "data:image/webp;base64,AAAA");
  });

  it("falls back to the calm placeholder, not a broken-image state, when hasPhoto was true but nothing resolves", async () => {
    const fetchPhoto = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<PhotoMedia kind="ingredient" hasPhoto size="list" fetchPhoto={fetchPhoto} />);
    await waitFor(() => expect(container.querySelector("img")).not.toBeInTheDocument());
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("falls back to the calm placeholder when fetchPhoto rejects", async () => {
    const fetchPhoto = vi.fn().mockRejectedValue(new Error("network down"));
    const { container } = render(<PhotoMedia kind="recipe" hasPhoto size="grid" fetchPhoto={fetchPhoto} />);
    await waitFor(() => expect(container.querySelector("svg")).toBeInTheDocument());
  });

  it("has no axe violations in the empty state", async () => {
    const { container } = render(
      <PhotoMedia kind="ingredient" hasPhoto={false} size="list" fetchPhoto={() => Promise.resolve(undefined)} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
