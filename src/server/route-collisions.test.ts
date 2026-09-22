import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { SapportaEnv } from "@sapporta/server";
import { addRoutesWithoutCollision } from "./route-collisions.js";

function apps() {
  const existing = new Hono<SapportaEnv>();
  existing.use("/api/*", async (_c, next) => next());
  existing.get("/api/tables", (c) => c.text("ours"));
  const target = new Hono<SapportaEnv>();
  target.get("/reports/trial-balance", (c) => c.text("ours"));
  return { existing, target, prefix: "/api", source: "dbu6.config.ts" };
}

describe("addRoutesWithoutCollision", () => {
  it("accepts new routes, the same path under another method, and middleware", async () => {
    const options = apps();
    await addRoutesWithoutCollision({
      ...options,
      add: () => {
        options.target.use("*", async (_c, next) => next());
        options.target.get("/reports/sample", (c) => c.text("theirs"));
        options.target.post("/reports/trial-balance", (c) => c.text("theirs"));
      },
    });
  });

  it("rejects a route the target already has, naming the source", async () => {
    const options = apps();
    await expect(
      addRoutesWithoutCollision({
        ...options,
        add: () => {
          options.target.get("/reports/trial-balance", (c) => c.text("theirs"));
        },
      }),
    ).rejects.toThrow(
      "dbu6.config.ts adds the route GET /api/reports/trial-balance",
    );
  });

  it("rejects a route that exists where the target will be mounted", async () => {
    const options = apps();
    await expect(
      addRoutesWithoutCollision({
        ...options,
        add: () => {
          options.target.get("/tables", (c) => c.text("theirs"));
        },
      }),
    ).rejects.toThrow("GET /api/tables");
  });

  it("rejects the same new route added twice", async () => {
    const options = apps();
    await expect(
      addRoutesWithoutCollision({
        ...options,
        add: () => {
          options.target.get("/sample", (c) => c.text("one"));
          options.target.get("/sample", (c) => c.text("two"));
        },
      }),
    ).rejects.toThrow("GET /api/sample");
  });
});
