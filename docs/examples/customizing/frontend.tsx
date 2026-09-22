// A project's optional frontend.tsx: pages and navigation entries that are
// not reports. Its default export is a Dbu6FrontendExtension, which the web
// app adds to its own routes and sidebar. Everything here is an addition; a
// path or a navigation target dbu6 already has is an error naming it.
import {
  Link,
  Screen,
  ScreenTitle,
  usePageTitle,
  type Dbu6FrontendExtension,
} from "dbu6/frontend";

// A page inside the signed-in app shell, at /goals. Any React component
// works; `Screen` and `ScreenTitle` give it the frame dbu6's own screens use.
function GoalsPage() {
  usePageTitle("Goals");
  return (
    <Screen
      width="narrow"
      header={
        <ScreenTitle title="Goals">
          What this year's money is for. Not a report: a page of the project's
          own.
        </ScreenTitle>
      }
    >
      <p className="mt-6 text-body text-ink-meta">
        See how it is going in <Link to="/reports">Reports</Link>.
      </p>
    </Screen>
  );
}

const extension: Dbu6FrontendExtension = {
  routes: [{ path: "/goals", Component: GoalsPage }],
  // Listed after dbu6's own entries, in the sidebar's second group.
  navigation: [{ label: "Goals", to: "/goals" }],
};

export default extension;
