import { describe, expect, it } from "vitest";
import { readProjectAuthEnv } from "./env.js";

const requiredEnv = {
  BETTER_AUTH_SECRET: "test-secret",
  SAPPORTA_PUBLIC_APP_URL: "http://localhost:5173",
  SAPPORTA_MAIL_FROM: "Sapporta <no-reply@example.test>",
};

describe("project auth environment", () => {
  it("uses the default API port when no port variable is set", () => {
    expect(readProjectAuthEnv(requiredEnv).apiPort).toBe(3000);
  });

  it("prefers the explicit Sapporta API port", () => {
    expect(
      readProjectAuthEnv({
        ...requiredEnv,
        SAPPORTA_API_PORT: "3001",
      }).apiPort,
    ).toBe(3001);
  });

  it("accepts the hosting-platform PORT fallback", () => {
    expect(
      readProjectAuthEnv({
        ...requiredEnv,
        PORT: "4100",
      }).apiPort,
    ).toBe(4100);
  });

  it("accepts matching explicit and hosting-platform ports", () => {
    expect(
      readProjectAuthEnv({
        ...requiredEnv,
        SAPPORTA_API_PORT: "3001",
        PORT: "3001",
      }).apiPort,
    ).toBe(3001);
  });

  it("rejects conflicting explicit and hosting-platform ports", () => {
    expect(() =>
      readProjectAuthEnv({
        ...requiredEnv,
        SAPPORTA_API_PORT: "3001",
        PORT: "4100",
      }),
    ).toThrow(
      "SAPPORTA_API_PORT and PORT must match when both are set; received 3001 and 4100.",
    );
  });
});
