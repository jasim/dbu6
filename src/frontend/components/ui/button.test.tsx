// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Button, type ButtonProps } from "./button";

/*
 * `waiting` and `disabled` compose: a waiting button is disabled whatever
 * the caller passes for `disabled`, and `disabled` still works on its own.
 * A disabled button is dimmed; a waiting one keeps its quiet fill instead.
 */

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function renderButton(props: Omit<ButtonProps, "ref">): HTMLButtonElement {
  act(() => root.render(createElement(Button, props, "Go")));
  const button = host.querySelector("button");
  if (!(button instanceof HTMLButtonElement)) throw new Error("No button");
  return button;
}

describe("Button", () => {
  it("stays disabled while waiting even when disabled={false} is passed", () => {
    const button = renderButton({ waiting: "Not yet", disabled: false });
    expect(button.disabled).toBe(true);
    expect(host.textContent).toContain("Not yet");
  });

  it("stays disabled while waiting when disabled is undefined", () => {
    const button = renderButton({ waiting: "Not yet", disabled: undefined });
    expect(button.disabled).toBe(true);
  });

  it("honours disabled on its own", () => {
    expect(renderButton({ disabled: true }).disabled).toBe(true);
    expect(renderButton({ disabled: false }).disabled).toBe(false);
  });

  it("dims a disabled button, and not a waiting one", () => {
    const disabled = renderButton({ disabled: true });
    expect(disabled.hasAttribute("data-disabled")).toBe(true);
    expect(disabled.className).toContain("data-disabled:opacity-50");

    const waiting = renderButton({ waiting: "Not yet" });
    expect(waiting.className).toContain("data-disabled:opacity-100");
    expect(waiting.className).not.toContain("data-disabled:opacity-50");
  });
});
