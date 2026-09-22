import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { extendCn } from "@sapporta/ui/cn";
import { useThemeStore } from "@sapporta/frontend/shell";
import type { Dbu6FrontendExtension } from "./extension";
import { SapportaApp } from "./SapportaApp";
import { buildApp } from "./App";
import { queryClient } from "./query-client";

let root: Root | undefined;

/**
 * Renders dbu6 into `#root`. The frontend host's entry calls it
 * (src/frontend-host/plugin.ts); nothing runs when this module is imported.
 *
 * No CSS is imported here. The host owns the one Tailwind run and imports
 * `dbu6/frontend.css` itself.
 *
 * `extension` is what the project adds: its reports, pages and navigation
 * entries (see `Dbu6FrontendExtension`). Our own entry passes nothing. An id
 * or a path that is already taken throws here, before anything renders.
 *
 * It may be called again: the host's entry accepts its own hot updates, and a
 * second call re-renders into the same root instead of creating another.
 */
export function startDbu6Frontend(extension?: Dbu6FrontendExtension): void {
  // Checked here as well as in the render, so a collision is an error at
  // startup with a message, not a blank page.
  buildApp(extension);

  // The type scale frontend.css registers, so class merging keeps a size next
  // to a colour instead of reading `text-body` as one.
  extendCn({
    text: [
      "display",
      "title",
      "heading",
      "subheading",
      "body",
      "row",
      "meta",
      "label",
    ],
  });

  // The design is light only: whatever the system prefers, the palette stays.
  useThemeStore.getState().forceMode("light");

  root ??= createRoot(document.getElementById("root")!);
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <SapportaApp extension={extension} />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}
