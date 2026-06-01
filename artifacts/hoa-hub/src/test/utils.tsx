import { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router as WouterRouter } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { AuthUser, UserRole } from "@/contexts/AuthContext";

export function makeUser(overrides: Partial<AuthUser> & { role: UserRole }): AuthUser {
  return {
    id: 1,
    email: "test@example.com",
    name: "Test User",
    unitId: null,
    boardMember: false,
    ...overrides,
  };
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

export function renderProviders(
  ui: ReactNode,
  opts: { initialPath?: string; client?: QueryClient } = {},
) {
  const { hook } = memoryLocation({ path: opts.initialPath ?? "/", record: true });
  const client = opts.client ?? makeQueryClient();
  return {
    client,
    hook,
    node: (
      <QueryClientProvider client={client}>
        <WouterRouter hook={hook}>{ui}</WouterRouter>
      </QueryClientProvider>
    ),
  };
}
