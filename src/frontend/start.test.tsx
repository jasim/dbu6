// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "./App";
import type { Dbu6FrontendExtension } from "./extension";
import { startDbu6Frontend } from "./start";

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const extension: Dbu6FrontendExtension = {
  reports: [
    {
      id: "sample-by-weekday",
      label: "Sample by Weekday",
      description: "A project's own report",
      Component: () => <p>sample report screen</p>,
    },
  ],
  routes: [{ path: "/goals", Component: () => <p>sample goals page</p> }],
  navigation: [{ label: "Goals", to: "/goals" }],
};

/** What the signed-in routes show at `url`, without the auth gate. */
async function screenAt(url: string, app = buildApp(extension)) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route>{app.protectedRoutes}</Route>
        </Routes>
      </MemoryRouter>,
    );
  });
  const text = host.textContent ?? "";
  act(() => root.unmount());
  host.remove();
  return text;
}

describe("a frontend extension", () => {
  it("adds a report to its route and to Your reports on the index", async () => {
    expect(await screenAt("/reports/sample-by-weekday")).toBe(
      "sample report screen",
    );
    const index = await screenAt("/reports");
    expect(index).toContain("Your reports");
    expect(index).toContain("Sample by Weekday");
    expect(index).toContain("Balance Sheet");
    expect(index).toContain("Create a report");
  });

  it("shows no Your reports section without a report of the project's", async () => {
    expect(await screenAt("/reports", buildApp())).not.toContain(
      "Your reports",
    );
  });

  it("adds a page and a navigation entry after dbu6's own", async () => {
    expect(await screenAt("/goals")).toBe("sample goals page");
    const { navigation } = buildApp(extension);
    expect(navigation.more.at(-1)).toEqual({ label: "Goals", to: "/goals" });
    expect(navigation.everyday.map((item) => item.to)).toContain("/reports");
  });

  it("refuses a report id dbu6 already has, naming it", () => {
    const duplicate = {
      reports: [{ ...extension.reports![0]!, id: "balance-sheet" }],
    };
    expect(() => startDbu6Frontend(duplicate)).toThrow(
      'A report with the id "balance-sheet" already exists',
    );
  });

  it("refuses a repeated id among the project's own reports", () => {
    const report = extension.reports![0]!;
    expect(() => buildApp({ reports: [report, report] })).toThrow(
      '"sample-by-weekday" already exists',
    );
  });

  it("refuses a path or a navigation target dbu6 already has", () => {
    const Component = () => null;
    for (const path of ["/import", "reports", "reports/net-worth", "login"]) {
      expect(() => buildApp({ routes: [{ path, Component }] })).toThrow(
        `A page with the path "${path.replace(/^\//, "")}" already exists`,
      );
    }
    expect(() =>
      buildApp({ navigation: [{ label: "Mine", to: "/settings" }] }),
    ).toThrow('A navigation entry to "/settings" already exists');
  });

  it("renders into the same root when started again", async () => {
    // The app asks the server who is signed in; leave it waiting.
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const host = document.createElement("div");
    host.id = "root";
    document.body.appendChild(host);
    await act(async () => startDbu6Frontend(extension));
    await act(async () => startDbu6Frontend(extension));
    expect(document.querySelectorAll("#root").length).toBe(1);
    host.remove();
  });
});
