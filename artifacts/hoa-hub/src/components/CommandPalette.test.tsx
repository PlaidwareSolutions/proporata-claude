import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderProviders, makeUser } from "@/test/utils";
import type { AuthUser } from "@/contexts/AuthContext";

let mockUser: AuthUser | null = null;

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, loading: false, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@workspace/api-client-react", () => {
  const buildings = [{ num: 1, address: "100 Main", street: "Main", units: 4, roofYear: 2010 }];
  const units = [{ id: "u-1", unit: "101", address: "100 Main #101", building: 1, beds: 2, baths: 1, sqft: 900 }];
  const vendors = [{ id: "v-1", name: "Acme Plumbing", tradeCategory: "Plumbing" }];
  const workOrders = [{ id: "WO-1", title: "Leak", category: "Plumbing", status: "open", priority: "med", building: 1, opened: "2025-01-01" }];
  const usersList = [
    { id: 5, name: "Alice Resident", email: "alice@example.com", role: "resident", unitId: "u-1" },
    { id: 6, name: "Bob Manager", email: "bob@example.com", role: "manager", unitId: null },
  ];
  return {
    useListBuildings: () => ({ data: buildings }),
    useListUnits: () => ({ data: units }),
    useListVendors: () => ({ data: vendors }),
    useListWorkOrders: () => ({ data: workOrders }),
    useListUsers: () => ({ data: usersList }),
    getListBuildingsQueryKey: () => ["buildings"],
    getListUnitsQueryKey: () => ["units"],
    getListVendorsQueryKey: () => ["vendors"],
    getListWorkOrdersQueryKey: () => ["work-orders"],
    getListUsersQueryKey: () => ["users"],
  };
});

import { CommandPalette } from "./CommandPalette";

const navItems = [
  { label: "Home", href: "/", section: "Main" },
  { label: "Calendar", href: "/calendar", section: "Main" },
];

beforeEach(() => {
  mockUser = null;
});

function renderPalette() {
  const { node } = renderProviders(
    <CommandPalette open={true} onClose={() => {}} navItems={navItems} />,
  );
  return render(node);
}

describe("CommandPalette role gating", () => {
  it("shows Buildings, Units, Vendors, Residents and Work Orders for managers", () => {
    mockUser = makeUser({ role: "manager" });
    renderPalette();
    expect(screen.getByText("Navigation")).toBeInTheDocument();
    expect(screen.getByText("Buildings")).toBeInTheDocument();
    expect(screen.getByText("Units")).toBeInTheDocument();
    expect(screen.getByText("Vendors")).toBeInTheDocument();
    expect(screen.getByText("Residents")).toBeInTheDocument();
    expect(screen.getByText("Work Orders")).toBeInTheDocument();
    expect(screen.getByText("Acme Plumbing")).toBeInTheDocument();
    expect(screen.getByText("Alice Resident")).toBeInTheDocument();
    expect(screen.getByText(/Building 1/)).toBeInTheDocument();
  });

  it("shows the same gated groups for admins", () => {
    mockUser = makeUser({ role: "admin" });
    renderPalette();
    expect(screen.getByText("Buildings")).toBeInTheDocument();
    expect(screen.getByText("Units")).toBeInTheDocument();
    expect(screen.getByText("Vendors")).toBeInTheDocument();
    expect(screen.getByText("Residents")).toBeInTheDocument();
  });

  it("hides Units, Vendors, Residents and Work Orders for residents", () => {
    mockUser = makeUser({ role: "resident", unitId: "u-1" });
    renderPalette();
    expect(screen.getByText("Navigation")).toBeInTheDocument();
    expect(screen.queryByText("Buildings")).not.toBeInTheDocument();
    expect(screen.queryByText("Units")).not.toBeInTheDocument();
    expect(screen.queryByText("Vendors")).not.toBeInTheDocument();
    expect(screen.queryByText("Residents")).not.toBeInTheDocument();
    expect(screen.queryByText("Work Orders")).not.toBeInTheDocument();
    expect(screen.queryByText("Acme Plumbing")).not.toBeInTheDocument();
    expect(screen.queryByText("Alice Resident")).not.toBeInTheDocument();
  });

  it("hides gated groups for board-member residents", () => {
    mockUser = makeUser({ role: "resident", boardMember: true, unitId: "u-1" });
    renderPalette();
    expect(screen.queryByText("Vendors")).not.toBeInTheDocument();
    expect(screen.queryByText("Units")).not.toBeInTheDocument();
    expect(screen.queryByText("Residents")).not.toBeInTheDocument();
  });
});
