import { describe, expect, it } from "vitest";
import { noAgentModelReason } from "./errors.js";

const SOL = { model: "gpt-5.6-sol", label: "GPT-5.6 Sol" };
const TERRA = { model: "gpt-5.6-terra", label: "GPT-5.6 Terra" };

describe("noAgentModelReason", () => {
  it("names the models, says dbu6 won't go lower, and quotes the floor", () => {
    expect(
      noAgentModelReason("codex", [
        { ...SOL, reason: "sample refusal" },
        { ...TERRA, reason: "Not logged in" },
      ]),
    ).toBe(
      "Codex didn't answer on GPT-5.6 Sol or GPT-5.6 Terra, and dbu6 doesn't use less capable models. GPT-5.6 Terra said: Not logged in. See Settings.",
    );
  });
});
