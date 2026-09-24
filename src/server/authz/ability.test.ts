import { describe, expect, it } from "vitest";
import { buildAbility } from "./ability.js";
import type { AppAuthFacts } from "./types.js";

function owner(): AppAuthFacts {
  return {
    principal: {
      kind: "user",
      membership: { roles: ["owner"] },
    },
  } as unknown as AppAuthFacts;
}

describe("buildAbility", () => {
  it("lets the owner read dbu_config and import_presets through the table API, and not write them", () => {
    const ability = buildAbility(owner());

    for (const table of ["dbu_config", "import_presets"] as const) {
      expect(ability.can("read", table)).toBe(true);
      expect(ability.can("export", table)).toBe(true);
      for (const action of ["create", "update", "delete"] as const) {
        expect(ability.can(action, table)).toBe(false);
      }
    }
    expect(ability.can("update", "journals")).toBe(true);
    // The workflow routes, the presets' writer among them, ask for this.
    expect(ability.can("manage", "all")).toBe(true);
  });
});
