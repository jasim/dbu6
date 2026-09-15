// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";
import { retiredPaths, retiredRoutes } from "./redirects";

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function Probe() {
  const { pathname, search, hash } = useLocation();
  return createElement("output", null, `${pathname}${search}${hash}`);
}

async function landingFor(url: string): Promise<string> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [url] },
        createElement(
          Routes,
          null,
          ...retiredRoutes,
          createElement(Route, { path: "*", element: createElement(Probe) }),
        ),
      ),
    );
  });
  const landed = host.querySelector("output")?.textContent ?? "";
  act(() => root.unmount());
  host.remove();
  return landed;
}

describe("retired routes", () => {
  for (const [from, to] of Object.entries(retiredPaths)) {
    it(`sends ${from} to ${to}`, async () => {
      expect(await landingFor(from)).toBe(to);
    });
  }

  it("keeps the search and hash of the old URL", async () => {
    expect(await landingFor("/tables/accounts?sort=name#top")).toBe(
      "/accounts?sort=name#top",
    );
  });

  it("leaves paths that still exist alone", async () => {
    expect(await landingFor("/views/post-drafts")).toBe("/views/post-drafts");
  });
});
