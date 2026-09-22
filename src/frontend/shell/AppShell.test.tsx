// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { AuthContextResponse } from "@sapporta/shared/contracts";
import { useAuthStore } from "@sapporta/frontend/auth";
import { useSchemaStore } from "@sapporta/frontend/schema";
import {
  SIDEBAR_DESKTOP_MEDIA_QUERY,
  SIDEBAR_EXPANDED_PREF_KEY,
} from "@sapporta/frontend/shell";
import { AppShell } from "./AppShell";
import type { Navigation } from "./navigation";

/*
 * The composition behaviour dbu6 took over from Sapporta's AppShell: where
 * the toggle sits, when navigation shows, and the header inset contract.
 * The sidebar controller itself is Sapporta's and tested there.
 */

const AUTH_CONTEXT = {
  user: {
    id: "user-1",
    name: "Sample Owner",
    email: "sample-owner@example.test",
    emailVerified: true,
  },
  workspace: {
    id: "workspace-1",
    name: "Sample household",
    slug: "sample-household",
    timeZone: "UTC",
    isOwner: true,
  },
  memberships: [
    {
      id: "member-1",
      workspace: {
        id: "workspace-1",
        name: "Sample household",
        slug: "sample-household",
        timeZone: "UTC",
      },
      role: "owner",
      isOwner: true,
    },
  ],
  role: "owner",
  isOwner: true,
} satisfies AuthContextResponse;

const NAVIGATION: Navigation = {
  everyday: [
    { label: "Home", to: "/" },
    { label: "Import statements", shortLabel: "Import", to: "/import" },
    { label: "Review", to: "/review", badge: "needsCategory" },
    { label: "Reports", to: "/reports" },
  ],
  more: [{ label: "All tools", to: "/tools" }],
};

let host: HTMLDivElement;
let root: Root;
let needsCategory = 0;

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  window.localStorage.clear();
  needsCategory = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ data: [], meta: { total: needsCategory } }),
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  useSchemaStore.getState().reset();
  useAuthStore.getState().reset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("dbu6 app shell", () => {
  it("leaves navigation out until a visitor has a session", async () => {
    installMedia({ desktop: true });
    await renderShell(page("Public content"), { signedIn: false });

    expect(host.querySelector("[data-application-page]")).toBeInstanceOf(
      HTMLElement,
    );
    expect(host.querySelector("[data-sidebar-region]")).toBeNull();
    expect(host.querySelector('nav[aria-label="Primary"]')).toBeNull();
    expect(host.querySelector("[data-shell-sidebar-toggle]")).toBeNull();
    expect(scrollRegion().className).not.toContain("--sap-page-header-inset");
  });

  it("keeps the desktop control first in the sidebar, expanded or as the rail", async () => {
    installMedia({ desktop: true });
    await renderShell(page("Application content"));

    const toggle = toggleButton("Collapse sidebar");
    const slot = toggle.closest('[data-sidebar-toggle-location="sidebar"]');
    expect(slot?.parentElement?.firstElementChild).toBe(slot);
    expect(toggle.closest("aside")?.className).toContain("w-[216px]");
    expect(scrollRegion().className).not.toContain("--sap-page-header-inset");

    toggle.focus();
    await click(toggle);

    // The same button, still first in the header of the rail, keeps focus.
    expect(toggleButton("Expand sidebar")).toBe(toggle);
    expect(document.activeElement).toBe(toggle);
    expect(toggle.closest("aside")?.className).toContain("w-full");
    expect(
      host.querySelector('[data-sidebar-toggle-location="content"]'),
    ).toBeNull();
    expect(scrollRegion().className).not.toContain("--sap-page-header-inset");
    expect(window.localStorage.getItem(SIDEBAR_EXPANDED_PREF_KEY)).toBe(
      "false",
    );

    await click(toggle);
    expect(toggleButton("Collapse sidebar")).toBe(toggle);
  });

  it("shows icons, the control, and the account initials in the rail", async () => {
    installMedia({ desktop: true });
    needsCategory = 12;
    window.localStorage.setItem(SIDEBAR_EXPANDED_PREF_KEY, "false");
    await renderShell(page("Application content"));

    const sidebar = host.querySelector("aside");
    expect(sidebar?.textContent).not.toContain("Sample household");
    // Labels stay in the links for assistive technology.
    const label = Array.from(navLink("/import").querySelectorAll("span")).find(
      (span) => span.textContent === "Import statements",
    );
    expect(label?.className).toContain("sr-only");
    // The count becomes a dot, and the link still names it.
    expect(navLink("/review").textContent).not.toContain("12");
    expect(navLink("/review").getAttribute("aria-label")).toBe("Review, 12");
    const account = host.querySelector(
      'button[aria-label="Open account menu for Sample Owner"]',
    );
    expect(account?.textContent).not.toContain("Settings");
  });

  it("returns to the rail when a destination is chosen", async () => {
    installMedia({ desktop: true });
    window.localStorage.setItem(SIDEBAR_EXPANDED_PREF_KEY, "false");
    await renderShell(page("Application content"));
    const region = host.querySelector<HTMLElement>("[data-sidebar-region]");
    const surface = host.querySelector<HTMLElement>("[data-sidebar-surface]");
    if (!region || !surface) throw new Error("Expected the sidebar region.");
    vi.useFakeTimers();

    // Resting on the rail opens the sidebar over the page.
    await pointerEnter(surface);
    await advance(250);
    expect(region.dataset.sidebarPeek).toBe("open");

    const link = navLink("/review");
    await pointerDown(link);
    await act(async () => link.click());

    expect(region.dataset.sidebarPeek).toBeUndefined();
    await advance(1000);
    expect(region.dataset.sidebarPeek).toBeUndefined();
  });

  it("returns to the rail when an account menu item is chosen", async () => {
    installMedia({ desktop: true });
    window.localStorage.setItem(SIDEBAR_EXPANDED_PREF_KEY, "false");
    await renderShell(page("Application content"));
    const region = host.querySelector<HTMLElement>("[data-sidebar-region]");
    const surface = host.querySelector<HTMLElement>("[data-sidebar-surface]");
    if (!region || !surface) throw new Error("Expected the sidebar region.");
    vi.useFakeTimers();

    await pointerEnter(surface);
    await advance(250);
    expect(region.dataset.sidebarPeek).toBe("open");

    const account = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Open account menu for Sample Owner"]',
    );
    if (!account) throw new Error("Expected the account menu trigger.");
    await pointerDown(account);
    await click(account);
    // Opening the menu is not choosing anything: the sidebar stays open.
    expect(region.dataset.sidebarPeek).toBe("open");

    const profile = [
      ...host.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.startsWith("Profile"));
    if (!profile) throw new Error("Expected the Profile action.");
    await click(profile);

    expect(region.dataset.sidebarPeek).toBeUndefined();
    await advance(1000);
    expect(region.dataset.sidebarPeek).toBeUndefined();
  });

  it("keeps the drawer opener over an unwrapped page on a compact screen", async () => {
    installMedia({ desktop: false });
    await renderShell(page("Application content"));

    expect(scrollRegion().className).toContain("overflow-y-auto");
    expect(scrollRegion().className).toContain("pb-[56px]");
    expect(scrollRegion().className).toContain(
      "[--sap-page-header-inset:3rem]",
    );
    expect(host.querySelector("[data-page-header]")).toBeNull();
    const opener = toggleButton("Open sidebar");
    expect(
      opener.closest('[data-sidebar-toggle-location="content"]'),
    ).toBeInstanceOf(HTMLElement);
  });

  it("shows the workspace in the sidebar header and the account card", async () => {
    installMedia({ desktop: true });
    await renderShell(page("Application content"));

    const sidebar = host.querySelector("aside");
    expect(sidebar?.textContent).toContain("dbu6");
    expect(sidebar?.textContent).toContain("Sample household");
    expect(
      host.querySelector(
        'button[aria-label="Open account menu for Sample Owner"]',
      ),
    ).toBeInstanceOf(HTMLButtonElement);
  });

  it("shows the needs-a-category count on Review and hides it at zero", async () => {
    installMedia({ desktop: true });
    needsCategory = 12;
    await renderShell(page("Application content"));

    const review = navLink("/review");
    expect(review.textContent).toContain("12");
    expect(review.getAttribute("aria-label")).toBe("Review, 12");
    expect(navLink("/").textContent).not.toContain("12");

    needsCategory = 0;
    await act(() => root.unmount());
    root = createRoot(host);
    await renderShell(page("Application content"));
    expect(navLink("/review").textContent).toBe("Review");
    expect(navLink("/review").getAttribute("aria-label")).toBeNull();
  });

  it("lists every item in the sidebar, with a rule before the second group", async () => {
    installMedia({ desktop: true });
    await renderShell(page("Application content"));

    const nav = host.querySelector("aside nav");
    const hrefs = Array.from(nav?.querySelectorAll("a") ?? []).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toEqual(["/", "/import", "/review", "/reports", "/tools"]);
    expect(nav?.querySelector("hr")).toBeInstanceOf(HTMLElement);
    expect(nav?.textContent).not.toContain("Everyday");
  });

  it("keeps only the everyday items on the bottom bar of a compact screen", async () => {
    installMedia({ desktop: false });
    await renderShell(page("Application content"));

    const bars = Array.from(
      host.querySelectorAll<HTMLElement>('nav[aria-label="Primary"]'),
    ).filter((nav) => nav.className.includes("fixed"));
    expect(bars).toHaveLength(1);
    const hrefs = Array.from(bars[0].querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toEqual(["/", "/import", "/review", "/reports"]);
    expect(host.querySelector('a[href="/tools"]')).toBeNull();
  });

  it("prints the short label on the bottom bar and keeps the full name", async () => {
    installMedia({ desktop: false });
    await renderShell(page("Application content"));

    const item = host.querySelector<HTMLAnchorElement>(
      'nav[aria-label="Primary"].fixed a[href="/import"]',
    );
    expect(item?.textContent).toBe("Import");
    expect(item?.getAttribute("aria-label")).toBe("Import statements");
  });

  it("keeps the full label in the sidebar", async () => {
    installMedia({ desktop: true });
    await renderShell(page("Application content"));

    expect(navLink("/import").textContent).toBe("Import statements");
    expect(navLink("/import").getAttribute("aria-label")).toBeNull();
  });
});

function page(text: string): ReactNode {
  return createElement("article", { "data-application-page": true }, text);
}

async function renderShell(
  content: ReactNode,
  props?: { signedIn?: boolean },
): Promise<void> {
  if (props?.signedIn ?? true) {
    useAuthStore.setState({
      session: { kind: "authenticated", context: AUTH_CONTEXT },
    });
  }
  await act(async () => {
    root.render(
      // A client per render, so no count is cached from an earlier one.
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(
          MemoryRouter,
          null,
          createElement(
            Routes,
            null,
            createElement(
              Route,
              { element: createElement(AppShell, { navigation: NAVIGATION }) },
              createElement(Route, { index: true, element: content }),
              // Choosing a destination keeps the shell: every path renders it.
              createElement(Route, { path: "*", element: content }),
            ),
          ),
        ),
      ),
    );
  });
  // The drawer loads on demand and the badge count arrives after a fetch.
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function installMedia({ desktop }: { desktop: boolean }) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === SIDEBAR_DESKTOP_MEDIA_QUERY ? desktop : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })) satisfies typeof window.matchMedia,
  );
}

function scrollRegion(): HTMLElement {
  const region = host.querySelector<HTMLElement>("[data-shell-scroll-region]");
  if (!region) throw new Error("Expected the shell scroll region.");
  return region;
}

function toggleButton(label: string): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"][aria-controls]`,
  );
  if (!button) throw new Error(`Expected "${label}" button.`);
  return button;
}

function navLink(to: string): HTMLAnchorElement {
  const link = host.querySelector<HTMLAnchorElement>(
    `aside nav a[href="${to}"]`,
  );
  if (!link) throw new Error(`Expected a link to ${to}.`);
  return link;
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => button.click());
}

// React derives enter and leave from `pointerover` and `pointerout`, using the
// element the pointer came from or went to.
async function pointerEnter(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(
      new PointerEvent("pointerover", {
        bubbles: true,
        pointerType: "mouse",
        relatedTarget: document.body,
      }),
    );
  });
}

async function pointerDown(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }),
    );
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}
