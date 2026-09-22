# Customizing dbu6: `dbu6.config.ts` and `frontend.tsx`

For a coding agent changing what dbu6 does in a project, beyond configuring
it (`user-config/`), writing a parser (`dbu6 docs parser-guide`) or writing a
report (`dbu6 docs reports`). Try those first: they need no wiring, and a
project that owns less code has less an upgrade can break.

Two optional files in the project root are found by name, the way Vite finds
`vite.config.ts`. dbu6 calls what they export, so the project never touches
startup order. Both are printed in full at the end of this guide; copy their
shape.

```
my-books/
  dbu6.config.ts   the server: a named seam, and routes that are not reports
  frontend.tsx     the web app: pages and navigation entries that are not reports
```

## Rules

- Everything is an addition. A route, page path or navigation target dbu6
  already has is an error that names it, at startup for a route and on the
  page for the frontend. Nothing of dbu6's is replaced; someone who needs that
  forks dbu6.
- Import only from `"dbu6/server"` (in `dbu6.config.ts`) and `"dbu6/frontend"`
  (in `frontend.tsx`). They are dbu6's promised surface; nothing else in the
  package is importable, and `node_modules/dbu6` is never edited.
- The two files are TypeScript that Node and the bundler run as they are, so
  the project's `tsconfig.json` rules apply: import sibling files by their real
  name, extension included; mark type-only imports with `type`; no enums,
  namespaces or constructor parameter properties.
- The books are read through `reportLedger(c, "<name>")` and never written
  from a route. There is no export that writes the ledger; changes to the
  books go through dbu6's own API (`dbu6 docs books`).
- No real names, account numbers or amounts in any file of the project.

## `dbu6.config.ts`

Default-exports `defineConfig({ ... })` from `"dbu6/server"`. The config is
imported before the database is opened, so it must not do work at import time.

### `extend(app)`

Called once, after dbu6's routes and the project's reports are mounted and
before the OpenAPI document is generated, with:

- `app.api`, the `/api` sub-app: private, with the signed-in user on every
  request. Build a `TsRestApi<SapportaEnv>` from a contract (`initContract`,
  `z`, `errorBodySchema`, all from `"dbu6/server"`; the path does not repeat
  `/api`), and mount it with `mountApi(app.api, yours)` so its routes reach
  OpenAPI as well as the router.
- `app.hono`, the whole server. A route added here is outside `/api` and
  public: for a webhook, say. Prefer `app.api`.
- `app.runtime`, the running pieces (database connection, auth, mailer).
  Nothing in it is promised across versions; a route that needs it is a
  reason to ask for an export.

In a handler, `reportLedger(c, "<name>")` answers 403 unless the signed-in
user may read reports, and returns the read-only ledger a report gets:
`all<Row>(sql, params?)` and `one<Row>(sql, params?)` over the `scoped_*`
relations, which hold only that user's rows. `dbu6 docs reports` describes
the relations and the ledger's tables.

`extend` may be `async`. A route that collides with one dbu6 or a report
already has stops startup with a message naming `dbu6.config.ts`.

### `loadCategorizer`

The one named seam. Reclassification, the statement import and the freeform
import all categorize through it, so replacing it here reaches all three;
replacing a route would not. Its type is `LoadCategorizer` from
`"dbu6/server"`: given the preset's settings (its prompt file names and the
LLM to use), return a categorizer.

The seam is narrow today: dbu6's own categorizer is not exported, so a
replacement stands in for it wholesale rather than wrapping it, and the
categorizer it returns is typed only through the seam
(`Awaited<ReturnType<LoadCategorizer>>`). Use it when the project's
categorization has to come from somewhere other than `user-config/` and the
coding agent; for a different set of rules or instructions, edit
`user-config/` instead.

## `frontend.tsx`

Default-exports a `Dbu6FrontendExtension` (a type from `"dbu6/frontend"`):

- `routes`: pages inside the signed-in app shell, each `{ path, Component }`.
  The path is under the app's root, such as `/goals` or `/goals/:goalId`, and
  the component is any React component. `Screen` and `ScreenTitle` give it
  the frame dbu6's own screens use; `usePageTitle` sets the tab's title;
  `Link`, `useParams` and `useSearchParams` are the router's, in the copy the
  app runs. Style with Tailwind classes; dbu6's theme tokens work.
- `navigation`: sidebar entries, each `{ label, to }` with an optional `icon`,
  listed after dbu6's own in the second group of the sidebar.
- `reports`: report definitions, if a report is written somewhere other than
  `reports/<id>/report.ts`. There is no reason to: the folder is found.

Import React's hooks, the router and the query hooks from `"dbu6/frontend"`,
never from `"react"`; the project has one dependency. Classes are picked up
from `frontend.tsx` and from files under `reports/`, so keep a page's
components in one of those places.

The file may be `frontend.ts` when it has no JSX.

## See it work

1. `dbu6 check`: it typechecks the project (`dbu6.config.ts` and
   `frontend.tsx` are in the template's `tsconfig.json`), builds the web app
   when the project has a `frontend.tsx`, and runs the reports' and parsers'
   tests. Every failing line comes with the tool's output, and nothing is
   changed.
2. Restart `dbu6 dev` (or `dbu6 start`) for a change to `dbu6.config.ts`:
   routes are mounted at startup. Pages hot-update under `dbu6 dev`.
3. A route added under `app.api` appears in the OpenAPI document and can be
   called with an agent access token (`dbu6 docs books`, "Reaching the app").

After `dbu6 upgrade`, `dbu6 check` is where an export these files use and
that has moved shows up, as a type error naming the file.

## The worked files
