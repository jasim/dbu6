import { useEffect } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { BootLoader, setNavigate } from "@sapporta/frontend/app";
import { Toaster } from "@sapporta/frontend/shell";
import { AppShell } from "./shell/AppShell";
import { AuthGate } from "@sapporta/frontend/auth/runtime";
import {
  appHomeRoute,
  appNavigation,
  appProtectedRoutes,
  appPublicShellRoutes,
  appPublicRoutes,
} from "./App";
import {
  sapportaNotFoundRoute,
  sapportaProtectedRoutes,
  sapportaPublicRoutes,
} from "./SapportaRoutes";

export function SapportaApp() {
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
              <AppShell navigation={appNavigation} />
            </BootLoader>
          }
        >
          {appPublicShellRoutes}
        </Route>

        <Route
          element={
            <BootLoader>
              <AuthGate>
                <AppShell navigation={appNavigation} />
              </AuthGate>
            </BootLoader>
          }
        >
          {appHomeRoute}
          {appProtectedRoutes}
          {sapportaProtectedRoutes}
          {sapportaNotFoundRoute}
        </Route>
      </Routes>
    </>
  );
}
