import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DisplayContext, LabelSlotProps } from "@sapporta/frontend/lookup";
import { accountRowDisplays } from "./account-name";

/*
 * How Sapporta draws an account wherever it shows one (`accountRowDisplays`):
 * the name with its parent path under it, except where the path would repeat
 * what the view shows already.
 */

const slot = accountRowDisplays.accounts.label;

function draw(
  context: Partial<DisplayContext>,
  parentPath: string | null = "Expenses > Kitchen",
): string {
  const props: LabelSlotProps = {
    id: 3,
    label: "Groceries",
    computed: { parentPath },
    defaultContent: createElement("i", null, "default"),
    context: {
      as: "reference",
      surface: "cell",
      density: "compact",
      hierarchyShown: false,
      ...context,
    },
  };
  return renderToStaticMarkup(createElement(slot.render, props));
}

describe("accountRowDisplays", () => {
  it("asks Sapporta for the accounts' parent paths", () => {
    expect(slot.needs).toEqual(["parentPath"]);
  });

  it("draws the grid's own name, with the path under it, in a cell", () => {
    const html = draw({ surface: "cell" });
    expect(html).toContain("<i>default</i>");
    expect(html).toContain("Expenses &gt; Kitchen");
  });

  it("draws the name and the path in a choice and the record sheet", () => {
    for (const surface of ["option", "field"] as const) {
      const html = draw({ surface, density: "regular" });
      expect(html).toContain("Groceries");
      expect(html).toContain("Expenses &gt; Kitchen");
      expect(html).not.toContain("default");
    }
  });

  it("draws the path alone beside a picker's input", () => {
    const html = draw({ surface: "selected", density: "regular" });
    expect(html).toContain("Expenses &gt; Kitchen");
    expect(html).not.toContain("Groceries");
  });

  it("keeps Sapporta's drawing in a tree, a filter chip and for a top account", () => {
    expect(draw({ hierarchyShown: true })).toBe("<i>default</i>");
    expect(draw({ surface: "chip" })).toBe("<i>default</i>");
    expect(draw({ surface: "option" }, null)).toBe("<i>default</i>");
  });
});
