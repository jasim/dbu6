// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
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
import type { CommentWriterStatus } from "../../shared/index";
import { CommentWriterNotice } from "./CommentWriterNotice";

/*
 * The comment writer's line in Review: shown only when it gave up on some
 * comments or the coding agent isn't answering, with Retry.
 */

let host: HTMLDivElement;
let root: Root;
let status: CommentWriterStatus;
let retried: number;

const IDLE: CommentWriterStatus = {
  running: false,
  pending: 0,
  failed: 0,
  last_error: null,
};

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  retried = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      const url = new URL(
        String(request ? request.url : input),
        "http://localhost",
      );
      if (method === "GET" && url.pathname.endsWith("/comment-writer/status")) {
        return Response.json(status);
      }
      if (method === "POST" && url.pathname.endsWith("/comment-writer/run")) {
        retried++;
        status = { ...IDLE, running: true, pending: 12 };
        return Response.json(status);
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(CommentWriterNotice),
      ),
    );
  });
  await settle();
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("CommentWriterNotice", () => {
  it("says nothing while the writer is on its way or done", async () => {
    status = { ...IDLE, running: true, pending: 40 };
    await render();
    expect(host.textContent).toBe("");
  });

  it("counts the comments it gave up on, and retries them", async () => {
    status = { ...IDLE, failed: 12 };
    await render();
    expect(host.textContent).toContain("Couldn't write 12 comments");

    const retry = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    )!;
    await act(async () => retry.click());
    await settle();

    expect(retried).toBe(1);
    expect(host.textContent).toBe("");
  });

  it("says when the coding agent isn't answering", async () => {
    status = { ...IDLE, pending: 30, last_error: "Sample agent failed." };
    await render();
    expect(host.textContent).toContain("Your coding agent isn't answering");
    expect(host.querySelector("[role=status]")?.getAttribute("title")).toBe(
      "Sample agent failed.",
    );
  });
});
