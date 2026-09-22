import { QueryClient } from "@tanstack/react-query";

// Caches and coordinates the frontend's backend requests. Sapporta's record
// form reads it, so it has to be mounted above the routes.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
