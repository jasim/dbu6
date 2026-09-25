// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  MemoryRouter,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  DraftClassification,
  ImportPresetsView,
  ReviewAccountDetail,
} from "../../shared/index";
import type { ReviewAccountContext } from "./ReviewAccount";
import {
  ReclassifyDraftsRedirect,
  RunCategorizerTab,
} from "./RunCategorizerTab";

/*
 * Run categorizer, a tab of the account's review: it sends the account's
 * drafts with no category, with the instructions the account imports with,
 * each file shown on a tab and another preset account's a choice away. A
 * dialog counts what the run categorized, what is left, and by category, and
 * OK goes back to the account's Overview. The old page's URL opens the tab.
 */

let host: HTMLDivElement;
let root: Root;
let requests: Array<{ method: string; url: URL; body: string | null }>;
let refreshed: number;

const ACCOUNTS = [
  { id: 5, name: "Sample Savings" },
  { id: 7, name: "Groceries" },
  { id: 8, name: "Dining" },
];

const PRESETS: ImportPresetsView = {
  institutions: [
    {
      id: 1,
      name: "Sample Bank",
      parsers: ["sample-bank-csv"],
      accounts: [
        {
          account_id: 8,
          name: "Sample Other",
          is_credit_card: false,
          account_identifiers: ["050505000008"],
          custom_mappings_filenames: ["custom_mappings_other.prompt"],
          ledger_account_name: "Dining",
        },
        {
          account_id: 5,
          name: "Sample Savings",
          is_credit_card: false,
          account_identifiers: ["050505000005"],
          custom_mappings_filenames: ["custom_mappings_sample.prompt"],
          ledger_account_name: "Sample Savings",
        },
      ],
    },
  ],
};

function draft(id: number, narration: string) {
  return {
    id,
    date: "2026-09-01",
    narration,
    withdrawal: "1000",
    deposit: "0",
    account_id: null,
  };
}

const DRAFTS = [
  draft(1, "NOPII SHOP ONE"),
  draft(2, "NOPII SHOP TWO"),
  draft(3, "NOPII CAFE"),
  draft(4, "NOPII UNKNOWN"),
];

const CLASSIFIED: DraftClassification = {
  transactions: [
    {
      id: 1,
      narration: "NOPII SHOP ONE",
      account_id: 7,
      account_name: "Groceries",
    },
    {
      id: 2,
      narration: "NOPII SHOP TWO",
      account_id: 7,
      account_name: "Groceries",
    },
    { id: 3, narration: "NOPII CAFE", account_id: 8, account_name: "Dining" },
    { id: 4, narration: "NOPII UNKNOWN", account_id: null, account_name: null },
  ],
  categorization: {
    agent: "claude-code",
    sent_count: 2,
    failed_count: 0,
    error: null,
    failure: null,
  },
  categorization_tally: {
    by_rule: 2,
    by_llm: 1,
    same_account: 0,
    uncategorized: 1,
    accounts: [
      { account_id: 7, account_name: "Groceries", count: 2 },
      { account_id: 8, account_name: "Dining", count: 1 },
    ],
  },
};

// What the classify route answers; a test sets it to a failed run.
let classifyAnswer: DraftClassification;
// The drafts with no category; a test sets it to none.
let draftsAnswer: typeof DRAFTS;

function respond(method: string, url: URL): unknown {
  if (url.pathname.endsWith("/tables/accounts")) return { data: ACCOUNTS };
  if (url.pathname.endsWith("/import-presets")) return PRESETS;
  const file = url.pathname.match(/\/import-presets\/mapping-files\/(.+)$/);
  if (file) {
    const filename = decodeURIComponent(file[1]!);
    return {
      filename,
      content:
        filename === "custom_mappings_sample.prompt"
          ? "Sample cafes map to 'Dining'."
          : null,
    };
  }
  if (url.pathname.endsWith("/tables/draft_transactions")) {
    return { data: draftsAnswer };
  }
  if (
    method === "POST" &&
    url.pathname.endsWith("/draft-transactions/classify")
  ) {
    return classifyAnswer;
  }
  throw new Error(`Unexpected request: ${method} ${url}`);
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  requests = [];
  refreshed = 0;
  classifyAnswer = CLASSIFIED;
  draftsAnswer = DRAFTS;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      const url = new URL(
        String(request ? request.url : input),
        "http://localhost",
      );
      const body =
        typeof init?.body === "string"
          ? init.body
          : request
            ? await request.clone().text()
            : null;
      requests.push({ method, url, body });
      return Response.json(respond(method, url));
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const DETAIL = {
  account: {
    account_id: 5,
    path: "Sample Savings",
    name: "Sample Savings",
    kind: "bank",
    drafts: 4,
    uncategorised: 4,
    duplicates: 0,
    balance_checks: 0,
    failing_checks: 0,
    draft_span: { first_date: "2026-09-01", last_date: "2026-09-01" },
  },
  checkpoint: null,
  has_opening_entry: true,
  closing: null,
  failing: [],
  duplicates: [],
  other_accounts: [],
} satisfies ReviewAccountDetail;

// The review frame, reduced to the context it hands its tabs.
function Frame() {
  return createElement(Outlet, {
    context: {
      detail: DETAIL,
      refresh: () => refreshed++,
      posted: null,
      setPosted: () => {},
    } satisfies ReviewAccountContext,
  });
}

function Where() {
  const { pathname, search } = useLocation();
  return createElement("code", null, pathname + search);
}

async function renderAt(url: string) {
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [url] },
        createElement(Where),
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: "/views/reclassify-drafts",
            element: createElement(ReclassifyDraftsRedirect),
          }),
          createElement(Route, {
            path: "/review",
            element: createElement("p", null, "picker"),
          }),
          createElement(
            Route,
            { path: "/review/:accountId", element: createElement(Frame) },
            createElement(Route, {
              index: true,
              element: createElement("p", null, "overview"),
            }),
            createElement(Route, {
              path: "run-categorizer",
              element: createElement(RunCategorizerTab),
            }),
          ),
        ),
      ),
    );
  });
  await settle();
}

const TAB = "/review/5/run-categorizer";

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const text = () => host.textContent ?? "";
const where = () => host.querySelector("code")?.textContent;
const dialog = () => document.querySelector('[role="dialog"]');

describe("Run categorizer", () => {
  it("sends the account's drafts with no category, with the instructions it imports with", async () => {
    await renderAt(TAB);

    expect(
      requests
        .find((r) => r.url.pathname.endsWith("/tables/draft_transactions"))
        ?.url.searchParams.get("filter[base_account_id][eq]"),
    ).toBe("5");
    expect(text()).toContain("4 drafts without a category");
    expect(text()).toContain("Sample Bank · Sample Savings");
    expect(text()).toContain("The instructions Sample Savings imports with.");
    expect(
      [...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent),
    ).toEqual(["custom_mappings_sample.prompt"]);
    expect(host.querySelector("pre")?.textContent).toBe(
      "Sample cafes map to 'Dining'.",
    );
    expect(classifyButton()?.textContent).toBe("Categorize 4 drafts");
  });

  it("sums up the run in a dialog, and OK goes back to the account's Overview", async () => {
    await renderAt(TAB);
    await act(async () => classifyButton()!.click());
    await settle();

    const classify = requests.find((r) => r.method === "POST");
    expect(JSON.parse(classify!.body!)).toEqual({
      ids: [1, 2, 3, 4],
      custom_mappings_filenames: ["custom_mappings_sample.prompt"],
    });
    expect(refreshed).toBe(1);
    expect(dialog()?.querySelector("h2")?.textContent).toBe(
      "Categorized 3 of 4 drafts",
    );
    expect(dialog()?.textContent).not.toMatch(/rules|Claude Code/);
    const facts = [...(dialog()?.querySelectorAll("dl div") ?? [])].map((row) =>
      [...row.children].map((cell) => cell.textContent),
    );
    expect(facts).toEqual([
      ["Categorized", "3"],
      ["Left to categorize", "1"],
      ["Groceries", "2"],
      ["Dining", "1"],
    ]);

    const ok = [...(dialog()?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "OK",
    );
    await act(async () => ok!.click());
    await settle();

    expect(where()).toBe("/review/5");
    expect(text()).toContain("overview");
  });

  it("says so when every draft already has a category", async () => {
    draftsAnswer = [];
    await renderAt(TAB);

    expect(text()).toContain("Every draft has a category");
    expect(classifyButton()).toBeUndefined();
  });

  it("is where the old Classify drafts page now goes", async () => {
    await renderAt("/views/reclassify-drafts?account=5");
    expect(where()).toBe(TAB);
  });

  it("sends the old page without an account to the Review picker", async () => {
    await renderAt("/views/reclassify-drafts");
    expect(where()).toBe("/review");
  });
});

function classifyButton() {
  return [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.startsWith("Categorize"),
  );
}

describe("Run categorizer when the coding agent can't be used", () => {
  const UNAVAILABLE: DraftClassification = {
    ...CLASSIFIED,
    categorization: {
      agent: "claude-code",
      sent_count: 2,
      failed_count: 2,
      error: "Claude Code didn't answer on Claude Sonnet. See Settings.",
      failure: "agent_unavailable",
    },
  };

  it("says so in a dialog that links to Settings", async () => {
    classifyAnswer = UNAVAILABLE;
    await renderAt(TAB);
    await act(async () => classifyButton()!.click());
    await settle();

    const dialogs = document.querySelectorAll('[role="dialog"]');
    expect(dialogs).toHaveLength(1);
    const dialog = dialogs[0];
    expect(dialog?.textContent).toContain("Claude Code isn't working");
    expect(dialog?.textContent).toContain(
      "Claude Code didn't answer on Claude Sonnet. See Settings.",
    );
    const settings = [...(dialog?.querySelectorAll("a") ?? [])].find(
      (a) => a.textContent === "Open Settings",
    );
    expect(settings?.getAttribute("href")).toBe("/settings");
  });

  it("sums up the run with what went wrong when only some calls failed", async () => {
    classifyAnswer = {
      ...UNAVAILABLE,
      categorization: {
        ...UNAVAILABLE.categorization,
        failed_count: 1,
        failure: "partial",
      },
    };
    await renderAt(TAB);
    await act(async () => classifyButton()!.click());
    await settle();

    expect(dialog()?.textContent).not.toContain("isn't working");
    expect(dialog()?.textContent).toContain(
      "Claude Code couldn't categorize some of them",
    );
    expect(dialog()?.textContent).toContain(
      "Once that's fixed, run the categorizer again.",
    );
  });
});
