import { useEffect, useMemo } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { BootLoader, setNavigate } from "@sapporta/frontend/app";
import { Toaster } from "@sapporta/frontend/shell";
import { AppShell } from "./shell/AppShell";
import { FocusLayout } from "./add-account/FocusCard";
import { AuthGate } from "@sapporta/frontend/auth/runtime";
import {
  appHomeRoute,
  appPublicShellRoutes,
  appPublicRoutes,
  buildApp,
} from "./App";
import type { Dbu6FrontendExtension } from "./extension";
import {
  sapportaNotFoundRoute,
  sapportaProtectedRoutes,
  sapportaPublicRoutes,
} from "./SapportaRoutes";

export function SapportaApp({
  extension,
}: {
  extension?: Dbu6FrontendExtension;
}) {
  const { navigation, protectedRoutes, focusRoutes } = useMemo(
    () => buildApp(extension),
    [extension],
  );
  const navigate = useNavigate();
  useEffect(() => {
    setNavigate(navigate);
  }, [navigate]);

  return (
    <>
      {/* Above BootLoader, so a toast posted while the gate remounts the
          routes (after a time zone change, say) still has an outlet. */}
      <Toaster
        position="top-center"
        richColors
        toastOptions={{
          classNames: { toast: "text-body", title: "font-semibold" },
        }}
      />
      <Routes>
        {sapportaPublicRoutes}
        {appPublicRoutes}

        <Route
          element={
            <BootLoader>
              <AppShell navigation={navigation} />
            </BootLoader>
          }
        >
          {appPublicShellRoutes}
        </Route>

        {/* Focus mode: signed in, one card, no sidebar. */}
        <Route
          element={
            <BootLoader>
              <AuthGate>
                <FocusLayout />
              </AuthGate>
            </BootLoader>
          }
        >
          {focusRoutes}
        </Route>

        <Route
          element={
            <BootLoader>
              <AuthGate>
                <AppShell navigation={navigation} />
              </AuthGate>
            </BootLoader>
          }
        >
          {appHomeRoute}
          {protectedRoutes}
          {sapportaProtectedRoutes}
          {sapportaNotFoundRoute}
        </Route>
      </Routes>
    </>
  );
}
