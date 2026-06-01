import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthUser } from "@/contexts/AuthContext";

let mockUser: AuthUser | null = null;
let mockLoading = false;

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: mockUser,
    loading: mockLoading,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/contexts/MapLayersContext", () => ({
  MapLayersProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useMapLayers: () => ({}),
}));

const { stub } = vi.hoisted(() => ({
  stub: (name: string) => ({
    default: () => <div data-testid={`stub-${name}`}>{name}</div>,
  }),
}));

// Stub every page module App.tsx imports so the production <Router /> can be
// rendered without pulling in the real page implementations (which depend on
// fetch / lots of api hooks). Matched routes resolve to a `stub-<Name>` div
// we can assert on.
vi.mock("@/pages/Home", () => stub("Home"));
vi.mock("@/pages/SiteMap", () => stub("SiteMap"));
vi.mock("@/pages/Overview", () => stub("Overview"));
vi.mock("@/pages/Buildings", () => stub("Buildings"));
vi.mock("@/pages/BuildingDetail", () => stub("BuildingDetail"));
vi.mock("@/pages/Units", () => stub("Units"));
vi.mock("@/pages/UnitDetail", () => stub("UnitDetail"));
vi.mock("@/pages/WorkOrders", () => stub("WorkOrders"));
vi.mock("@/pages/WorkOrderDetail", () => stub("WorkOrderDetail"));
vi.mock("@/pages/CreateWorkOrder", () => stub("CreateWorkOrder"));
vi.mock("@/pages/Insurance", () => stub("Insurance"));
vi.mock("@/pages/Documents", () => stub("Documents"));
vi.mock("@/pages/Reports", () => stub("Reports"));
vi.mock("@/pages/AmenityFinancials", () => stub("AmenityFinancials"));
vi.mock("@/pages/Settings", () => stub("Settings"));
vi.mock("@/pages/Boards", () => stub("Boards"));
vi.mock("@/pages/Communications", () => stub("Communications"));
vi.mock("@/pages/Login", () => stub("Login"));
vi.mock("@/pages/ResidentPortal", () => stub("ResidentPortal"));
vi.mock("@/pages/ResidentDocuments", () => stub("ResidentDocuments"));
vi.mock("@/pages/ResidentProfile", () => stub("ResidentProfile"));
vi.mock("@/pages/VerifyEmail", () => stub("VerifyEmail"));
vi.mock("@/pages/ArchitecturalRequests", () => stub("ArchitecturalRequests"));
vi.mock("@/pages/ArchitecturalRequestDetail", () => stub("ArchitecturalRequestDetail"));
vi.mock("@/pages/ResidentArchitectural", () => stub("ResidentArchitectural"));
vi.mock("@/pages/MyAccount", () => stub("MyAccount"));
vi.mock("@/pages/Billing", () => stub("Billing"));
vi.mock("@/pages/Payments", () => stub("Payments"));
vi.mock("@/pages/Vendors", () => stub("Vendors"));
vi.mock("@/pages/VendorDetail", () => stub("VendorDetail"));
vi.mock("@/pages/Bids", () => stub("Bids"));
vi.mock("@/pages/BidDetail", () => stub("BidDetail"));
vi.mock("@/pages/Motions", () => stub("Motions"));
vi.mock("@/pages/Resolutions", () => stub("Resolutions"));
vi.mock("@/pages/ResidentResolutions", () => stub("ResidentResolutions"));
vi.mock("@/pages/ResidentBoard", () => stub("ResidentBoard"));
vi.mock("@/pages/ResidentAmenities", () => stub("ResidentAmenities"));
vi.mock("@/pages/MyPets", () => stub("MyPets"));
vi.mock("@/pages/PetsAdmin", () => stub("PetsAdmin"));
vi.mock("@/pages/Amenities", () => stub("Amenities"));
vi.mock("@/pages/MailRoom", () => stub("MailRoom"));
vi.mock("@/pages/MailRoomKiosk", () => stub("MailRoomKiosk"));
vi.mock("@/pages/ResidentMail", () => stub("ResidentMail"));
vi.mock("@/pages/EvCharging", () => stub("EvCharging"));
vi.mock("@/pages/Patrol", () => stub("Patrol"));
vi.mock("@/pages/ParkingPermits", () => stub("ParkingPermits"));
vi.mock("@/pages/FobInventory", () => stub("FobInventory"));
vi.mock("@/pages/PoolTagsAdmin", () => stub("PoolTagsAdmin"));
vi.mock("@/pages/Calendar", () => stub("Calendar"));
vi.mock("@/pages/Meetings", () => stub("Meetings"));
vi.mock("@/pages/MeetingDetail", () => stub("MeetingDetail"));
vi.mock("@/pages/QuoteSubmit", () => stub("QuoteSubmit"));
vi.mock("@/pages/not-found", () => stub("NotFound"));

import { Router as WouterRouter } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "./App";

function renderAt(path: string) {
  const { hook } = memoryLocation({ path, record: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WouterRouter hook={hook}>
        <Router />
      </WouterRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockUser = {
    id: 1,
    email: "r@example.com",
    name: "R",
    role: "resident",
    unitId: "u-1",
    boardMember: false,
  };
  mockLoading = false;
});

describe("App routing — /portal redirect and deep routes", () => {
  it("/portal redirects to / (rendering Home)", () => {
    renderAt("/portal");
    expect(screen.getByTestId("stub-Home")).toBeInTheDocument();
    expect(screen.queryByTestId("stub-ResidentPortal")).not.toBeInTheDocument();
  });

  it("/portal/documents still renders ResidentDocuments for residents", () => {
    renderAt("/portal/documents");
    expect(screen.getByTestId("stub-ResidentDocuments")).toBeInTheDocument();
  });

  it("/portal/architectural still renders for residents", () => {
    renderAt("/portal/architectural");
    expect(screen.getByTestId("stub-ResidentArchitectural")).toBeInTheDocument();
  });

  it("/portal/architectural/:id still renders for residents", () => {
    renderAt("/portal/architectural/AR-1");
    expect(screen.getByTestId("stub-ArchitecturalRequestDetail")).toBeInTheDocument();
  });

  it("/portal/account still renders MyAccount for residents", () => {
    renderAt("/portal/account");
    expect(screen.getByTestId("stub-MyAccount")).toBeInTheDocument();
  });

  it("/portal/board, /portal/resolutions, /portal/amenities, /portal/pets, /portal/mail still render", () => {
    renderAt("/portal/board");
    expect(screen.getByTestId("stub-ResidentBoard")).toBeInTheDocument();
    renderAt("/portal/resolutions");
    expect(screen.getByTestId("stub-ResidentResolutions")).toBeInTheDocument();
    renderAt("/portal/amenities");
    expect(screen.getByTestId("stub-ResidentAmenities")).toBeInTheDocument();
    renderAt("/portal/pets");
    expect(screen.getByTestId("stub-MyPets")).toBeInTheDocument();
    renderAt("/portal/mail");
    expect(screen.getByTestId("stub-ResidentMail")).toBeInTheDocument();
  });

  it("/portal redirects managers to / (Home), not the resident portal", () => {
    mockUser = {
      id: 2,
      email: "m@example.com",
      name: "M",
      role: "manager",
      unitId: null,
      boardMember: false,
    };
    renderAt("/portal");
    expect(screen.getByTestId("stub-Home")).toBeInTheDocument();
  });

  it("/portal/documents redirects managers to / (resident-only deep route)", () => {
    mockUser = {
      id: 2,
      email: "m@example.com",
      name: "M",
      role: "manager",
      unitId: null,
      boardMember: false,
    };
    renderAt("/portal/documents");
    expect(screen.getByTestId("stub-Home")).toBeInTheDocument();
    expect(screen.queryByTestId("stub-ResidentDocuments")).not.toBeInTheDocument();
  });
});
