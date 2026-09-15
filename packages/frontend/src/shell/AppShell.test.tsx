// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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

const NAVIGATION: Navigation = [
  {
    label: "Home",
    items: [{ label: "Accounting home", to: "/welcome" }],
  },
  {
    label: "Review drafts",
    items: [
      {
        label: "Draft entries",
        to: "/tables/draft_transactions",
        badge: "needsCategory",
      },
    ],
  },
];

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

  it("keeps the desktop control inside the sidebar while it is expanded", async () => {
    installMedia({ desktop: true });
    await renderShell(page("Application content"));

    const collapseToggle = toggleButton("Collapse sidebar");
    expect(
      collapseToggle.closest('[data-sidebar-toggle-location="sidebar"]'),
    ).toBeInstanceOf(HTMLElement);
    expect(collapseToggle.closest("aside")?.className).toContain("w-[248px]");
    expect(scrollRegion().className).not.toContain("--sap-page-header-inset");

    await click(collapseToggle);

    const expandToggle = toggleButton("Expand sidebar");
    expect(
      expandToggle.closest('[data-sidebar-toggle-location="content"]'),
    ).toBeInstanceOf(HTMLElement);
    expect(expandToggle.closest("[data-shell-content]")).toBeInstanceOf(
      HTMLElement,
    );
    expect(scrollRegion().className).toContain(
      "[--sap-page-header-inset:3rem]",
    );
    expect(window.localStorage.getItem(SIDEBAR_EXPANDED_PREF_KEY)).toBe(
      "false",
    );

    await click(expandToggle);
    expect(
      toggleButton("Collapse sidebar").closest(
        '[data-sidebar-toggle-location="sidebar"]',
      ),
    ).toBeInstanceOf(HTMLElement);
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

  it("shows the needs-a-category count on Draft entries and hides it at zero", async () => {
    installMedia({ desktop: true });
    needsCategory = 12;
    await renderShell(page("Application content"));

    const draftEntries = navLink("/tables/draft_transactions");
    expect(draftEntries.textContent).toContain("12");
    expect(navLink("/welcome").textContent).not.toContain("12");

    needsCategory = 0;
    await act(() => root.unmount());
    root = createRoot(host);
    await renderShell(page("Application content"));
    expect(navLink("/tables/draft_transactions").textContent).toBe(
      "Draft entries",
    );
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
          ),
        ),
      ),
    );
  });
  // The drawer loads on demand and the badge count arrives after a fetch.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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
