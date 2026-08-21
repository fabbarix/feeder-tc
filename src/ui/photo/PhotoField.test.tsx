import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { ToastProvider } from "../components/Toast/ToastProvider.tsx";
import { PhotoField, type PhotoDraft } from "./PhotoField.tsx";

// jsdom has no real canvas/WebP encoder (same limitation
// src/photos/byte-budget.test.ts's own sibling e2e spec documents), so the
// encoder itself is mocked here — this test is about PhotoField's
// add/replace/remove state machine, not the encoder (already covered by
// e2e/wp-photo-encoder.spec.ts against a real browser).
vi.mock("../../photos/encode.ts", () => ({
  encodePhotoDataUrl: vi.fn().mockResolvedValue("data:image/webp;base64,ENCODED"),
}));

function Harness({ initial, hasPhoto = false }: { initial: PhotoDraft; hasPhoto?: boolean }) {
  const [draft, setDraft] = useState(initial);
  return (
    <ToastProvider>
      <PhotoField hasPhoto={hasPhoto} value={draft} onChange={setDraft} />
      <p data-testid="status">{draft.status}</p>
    </ToastProvider>
  );
}

describe("PhotoField", () => {
  it("shows the dashed add affordance when there is no photo", () => {
    render(<Harness initial={{ status: "unchanged" }} />);
    expect(screen.getByRole("button", { name: /add a photo/i })).toBeInTheDocument();
  });

  it("picking a file encodes it and reports status 'new'", async () => {
    const { container } = render(<Harness initial={{ status: "unchanged" }} />);
    const user = userEvent.setup();
    const file = new File(["fake-bytes"], "chili.jpg", { type: "image/jpeg" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("new"));
    // Decorative preview (`alt=""`) is intentionally excluded from the
    // accessibility tree's "img" role — queried by tag, not role.
    expect(container.querySelector("img")).toHaveAttribute("src", "data:image/webp;base64,ENCODED");
    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("clicking Remove on a new photo reports status 'removed' and returns to the add affordance", async () => {
    render(<Harness initial={{ status: "unchanged" }} />);
    const user = userEvent.setup();
    const file = new File(["fake-bytes"], "chili.jpg", { type: "image/jpeg" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("new"));

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByTestId("status")).toHaveTextContent("removed");
    expect(screen.getByRole("button", { name: /add a photo/i })).toBeInTheDocument();
  });

  it("previews an existing photo via fetchPhoto when hasPhoto is true", async () => {
    const { container } = render(
      <ToastProvider>
        <PhotoField
          hasPhoto
          fetchPhoto={() => Promise.resolve("data:image/webp;base64,EXISTING")}
          value={{ status: "unchanged" }}
          onChange={() => undefined}
        />
      </ToastProvider>,
    );
    await waitFor(() => expect(container.querySelector("img")).toBeInTheDocument());
    expect(container.querySelector("img")).toHaveAttribute("src", "data:image/webp;base64,EXISTING");
  });

  it("has no axe violations in the empty state", async () => {
    const { container } = render(<Harness initial={{ status: "unchanged" }} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
