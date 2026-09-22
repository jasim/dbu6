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
  it("lets the owner read dbu_config through the table API, and not write it", () => {
    const ability = buildAbility(owner());

    expect(ability.can("read", "dbu_config")).toBe(true);
    expect(ability.can("export", "dbu_config")).toBe(true);
    for (const action of ["create", "update", "delete"] as const) {
      expect(ability.can(action, "dbu_config")).toBe(false);
    }
    expect(ability.can("update", "journals")).toBe(true);
  });
});
