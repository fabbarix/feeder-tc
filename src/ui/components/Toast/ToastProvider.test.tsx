import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { ToastProvider } from "./ToastProvider.tsx";
import { ToastViewport } from "./ToastViewport.tsx";
import { useToast } from "./useToast.ts";

function Harness() {
  const { showToast } = useToast();
  return (
    <>
      <button type="button" onClick={() => showToast({ variant: "success", title: "Saved" })}>
        Fire toast
      </button>
      <button
        type="button"
        onClick={() =>
          showToast({
            variant: "warning",
            title: "Skipped row 7 in Ingredients",
            description: "unknown unit banana-units",
          })
        }
      >
        Fire warning
      </button>
      <ToastViewport />
    </>
  );
}

describe("ToastProvider / useToast", () => {
  it("renders a toast fired via showToast", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Fire toast" }));

    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("renders a warning-variant toast with title and description", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Fire warning" }));

    expect(screen.getByText(/row 7 in Ingredients/i)).toBeInTheDocument();
    expect(screen.getByText("unknown unit banana-units")).toBeInTheDocument();
  });

  it("dismisses a toast when its dismiss button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Fire toast" }));
    await user.click(screen.getByRole("button", { name: /dismiss: saved/i }));

    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("throws a clear error when useToast is used outside a provider", () => {
    function Rogue() {
      useToast();
      return null;
    }
    expect(() => render(<Rogue />)).toThrowError(/ToastProvider/);
  });

  it("has no axe violations with a toast visible", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Fire warning" }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
