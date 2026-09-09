import { useEffect } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { AppShell, setNavigate } from "@sapporta/frontend/app";
import { BootLoader } from "@sapporta/frontend/app";
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
    <Routes>
      {sapportaPublicRoutes}
      {appPublicRoutes}

      <Route
        element={
          <BootLoader>
            <AppShell
              navigation={appNavigation}
              showFrameworkNavigation={false}
            />
          </BootLoader>
        }
      >
        {appPublicShellRoutes}
      </Route>

      <Route
        element={
          <BootLoader>
            <AuthGate>
              <AppShell
                navigation={appNavigation}
                showFrameworkNavigation={false}
              />
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
  );
}
