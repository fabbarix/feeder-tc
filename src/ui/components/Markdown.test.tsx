import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders plain prose as a paragraph", () => {
    const { container } = render(<Markdown text="Stir every 5 minutes so it doesn't catch." />);
    expect(container.querySelector("p")?.textContent).toBe("Stir every 5 minutes so it doesn't catch.");
  });

  it("renders **bold** and *italic*", () => {
    const { container } = render(<Markdown text="Use **low** heat, stir *often*." />);
    expect(container.querySelector("strong")?.textContent).toBe("low");
    expect(container.querySelector("em")?.textContent).toBe("often");
  });

  it("renders a [label](https://...) link with an explicit style and safe rel/target", () => {
    const { container } = render(<Markdown text="See [the source recipe](https://example.com/chili)." />);
    const link = container.querySelector("a");
    expect(link).toHaveAttribute("href", "https://example.com/chili");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link?.textContent).toBe("the source recipe");
  });

  it("never renders literal HTML as markup — a script tag stays inert text", () => {
    const { container } = render(<Markdown text="<script>alert(1)</script>" />);
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("splits blank-line-separated paragraphs and keeps single newlines as line breaks", () => {
    const { container } = render(<Markdown text={"First paragraph,\nsecond line.\n\nSecond paragraph."} />);
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]?.querySelector("br")).toBeInTheDocument();
  });

  it("renders nothing for blank text", () => {
    const { container } = render(<Markdown text="   " />);
    expect(container.firstChild).toBeNull();
  });

  it("has no axe violations", async () => {
    const { container } = render(<Markdown text="Some **detail** with a [link](https://example.com)." />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
