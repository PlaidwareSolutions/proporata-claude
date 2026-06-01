import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderProviders, makeUser } from "@/test/utils";
import type { AuthUser } from "@/contexts/AuthContext";

let mockUser: AuthUser | null = null;
let mockAccount: { occupancy: "owner" | "tenant"; balanceCents: number; status: string } | null = null;
let mockAccountLoading = false;

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, loading: false, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@workspace/api-client-react", () => ({
  useListBuildings: () => ({ data: [] }),
  useListWorkOrders: () => ({ data: [] }),
  useListInsurance: () => ({ data: [] }),
  useGetMyAccount: () => ({ data: mockAccount, isLoading: mockAccountLoading }),
  useGetUnit: () => ({ data: null }),
  useCreateWorkOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useListMeetings: () => ({ data: [] }),
  getGetMyAccountQueryKey: () => ["my-account"],
  getGetUnitQueryKey: (id: string) => ["unit", id],
  getListWorkOrdersQueryKey: () => ["work-orders"],
}));

vi.mock("@/lib/motionsApi", () => ({
  motionsApi: { list: vi.fn(async () => []) },
}));

vi.mock("@/components/MotionsAwaitingVoteWidget", () => ({
  MotionsAwaitingVoteWidget: () => <div data-testid="motions-widget" />,
}));

vi.mock("@/components/calendar/UpcomingEventsWidget", () => ({
  default: () => <div data-testid="events-widget" />,
}));

vi.mock("@/components/Layout", () => ({
  Layout: ({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) => (
    <div>
      <h1 data-testid="page-title">{title}</h1>
      {subtitle && <p data-testid="page-subtitle">{subtitle}</p>}
      <div>{children}</div>
    </div>
  ),
}));

import Home from "./Home";

beforeEach(() => {
  mockUser = null;
  mockAccount = null;
  mockAccountLoading = false;
});

function renderHome() {
  const { node } = renderProviders(<Home />);
  return render(node);
}

describe("Home role-aware rendering", () => {
  it("renders ManagerHome for manager role", () => {
    mockUser = makeUser({ role: "manager" });
    renderHome();
    expect(screen.getByTestId("page-title")).toHaveTextContent("Home");
    expect(screen.getByText("Open work orders")).toBeInTheDocument();
    expect(screen.getByText("What HOA Hub solves")).toBeInTheDocument();
  });

  it("renders ManagerHome for admin role", () => {
    mockUser = makeUser({ role: "admin" });
    renderHome();
    expect(screen.getByText("Open work orders")).toBeInTheDocument();
  });

  it("renders BoardHome when resident is a board member", () => {
    mockUser = makeUser({ role: "resident", boardMember: true, unitId: "u1" });
    renderHome();
    expect(screen.getByTestId("page-title")).toHaveTextContent("Board Dashboard");
    expect(screen.getByText("Open motions")).toBeInTheDocument();
    expect(screen.getByText("Upcoming meetings")).toBeInTheDocument();
  });

  it("renders OwnerHome for resident with owner occupancy", () => {
    mockUser = makeUser({ role: "resident", boardMember: false, unitId: "u1" });
    mockAccount = { occupancy: "owner", balanceCents: 0, status: "current" };
    renderHome();
    expect(screen.getByTestId("page-title")).toHaveTextContent("Welcome home");
    expect(screen.getByTestId("page-subtitle")).toHaveTextContent(/unit, requests, and account/i);
    expect(screen.getByText("My Account")).toBeInTheDocument();
  });

  it("renders TenantHome for resident with tenant occupancy", () => {
    mockUser = makeUser({ role: "resident", boardMember: false, unitId: "u1" });
    mockAccount = { occupancy: "tenant", balanceCents: 0, status: "current" };
    renderHome();
    expect(screen.getByTestId("page-title")).toHaveTextContent("Welcome home");
    expect(screen.getByTestId("page-subtitle")).toHaveTextContent(/requests and community/i);
    expect(screen.queryByText("My Account")).not.toBeInTheDocument();
  });

  it("renders TenantHome for resident without a unit (no account fetch)", () => {
    mockUser = makeUser({ role: "resident", boardMember: false, unitId: null });
    renderHome();
    expect(screen.getByTestId("page-subtitle")).toHaveTextContent(/requests and community/i);
  });

  it("shows a loading state while the owner account query is pending", () => {
    mockUser = makeUser({ role: "resident", boardMember: false, unitId: "u1" });
    mockAccount = null;
    mockAccountLoading = true;
    renderHome();
    expect(screen.getByText(/Loading your dashboard/i)).toBeInTheDocument();
    expect(screen.queryByText("My Account")).not.toBeInTheDocument();
  });
});
