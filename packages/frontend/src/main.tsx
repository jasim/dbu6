import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { extendCn } from "@sapporta/ui/cn";
import { useThemeStore } from "@sapporta/frontend/shell";
// Single CSS entrypoint. app.css runs Tailwind and pulls in
// @sapporta/ui's tokens and base rules — edit it to customize.
import "./app.css";
import { SapportaApp } from "./SapportaApp";
import { queryClient } from "./query-client";

// The type scale app.css registers, so class merging keeps a size next to a
// colour instead of reading `text-body` as one.
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SapportaApp />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
