import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { renderProviders, makeUser } from "@/test/utils";
import type { AuthUser } from "@/contexts/AuthContext";

let mockUser: AuthUser | null = null;
let mockOccupancy: "owner" | "tenant" = "tenant";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: mockUser,
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/contexts/MapLayersContext", () => ({
  useMapLayers: () => ({
    layers: { buildings: true, openWO: true, insuranceGaps: true, roofStatus: false },
    setLayer: vi.fn(),
  }),
  MapLayersProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/help/HelpPanel", () => ({
  HelpPanel: () => null,
}));
vi.mock("@/components/help/OnboardingTour", () => ({
  OnboardingTour: () => null,
}));
vi.mock("@/components/CommandPalette", () => ({
  CommandPalette: () => null,
}));
vi.mock("@/components/Breadcrumbs", () => ({
  Breadcrumbs: () => null,
}));
vi.mock("@/components/AppFooter", () => ({
  AppFooter: () => null,
}));

vi.mock("@/lib/motionsApi", () => ({
  motionsApi: { list: vi.fn(async () => []) },
}));

vi.mock("@workspace/api-client-react", () => ({
  useListWorkOrders: () => ({ data: [] }),
  useListInsurance: () => ({ data: [] }),
  useListBuildings: () => ({ data: [] }),
  useGetSettings: () => ({ data: { name: "Test HOA" } }),
  useListNotifications: () => ({ data: [] }),
  useMarkNotificationRead: () => ({ mutateAsync: vi.fn() }),
  useMarkAllNotificationsRead: () => ({ mutateAsync: vi.fn() }),
  useGetMyAccount: () => ({ data: { occupancy: mockOccupancy } }),
  useGetUnit: () => ({ data: null }),
  getGetMyAccountQueryKey: () => ["my-account"],
  getGetUnitQueryKey: (id: string) => ["unit", id],
  getListNotificationsQueryKey: () => ["notifications"],
}));

import { Layout } from "./Layout";

function renderLayout(initialPath = "/") {
  const { node } = renderProviders(
    <Layout title="Test Page">
      <div>content</div>
    </Layout>,
    { initialPath },
  );
  return render(node);
}

// Top-nav section triggers always carry data-testid="nav-section-<slug>".
// To filter out the (also always-rendered) mobile drawer's triggers, we rely
// on the fact that the mobile drawer only mounts its section triggers when
// `mobileNavOpen` is true. In these tests we never open the drawer, so any
// `nav-section-*` element corresponds to the desktop top-nav.
function getDesktopSectionSlugs(): string[] {
  const all = document.querySelectorAll<HTMLElement>('[data-testid^="nav-section-"]');
  const slugs: string[] = [];
  for (const el of Array.from(all)) {
    const tid = el.getAttribute("data-testid") ?? "";
    if (tid.startsWith("nav-section-panel-")) continue; // dropdown panel, not trigger
    slugs.push(tid.replace(/^nav-section-/, ""));
  }
  return slugs;
}

beforeEach(() => {
  mockUser = null;
  mockOccupancy = "tenant";
});

describe("Layout top-nav role gating", () => {
  it("admin sees all manager sections plus Workspace", () => {
    mockUser = makeUser({ role: "admin" });
    renderLayout();
    expect(getDesktopSectionSlugs()).toEqual([
      "overview",
      "property",
      "operations",
      "governance",
      "financials",
      "community",
      "library",
      "workspace",
    ]);
  });

  it("manager sees the manager sections without Workspace", () => {
    mockUser = makeUser({ role: "manager" });
    renderLayout();
    expect(getDesktopSectionSlugs()).toEqual([
      "overview",
      "property",
      "operations",
      "governance",
      "financials",
      "community",
      "library",
    ]);
  });

  it("resident tenant sees only Home, My Place, Community, Requests", () => {
    mockUser = makeUser({ role: "resident", unitId: "u-1" });
    mockOccupancy = "tenant";
    renderLayout();
    expect(getDesktopSectionSlugs()).toEqual([
      "home",
      "my-place",
      "community",
      "requests",
    ]);
  });

  it("resident owner sees the same sections as tenants and gets My Account in My Place", () => {
    mockUser = makeUser({ role: "resident", unitId: "u-1" });
    mockOccupancy = "owner";
    renderLayout();
    expect(getDesktopSectionSlugs()).toEqual([
      "home",
      "my-place",
      "community",
      "requests",
    ]);
    fireEvent.click(screen.getByTestId("nav-section-my-place"));
    const panel = screen.getByTestId("nav-section-panel-my-place");
    expect(within(panel).getByText("My Account")).toBeInTheDocument();
  });

  it("resident board member also sees a Governance section", () => {
    mockUser = makeUser({ role: "resident", unitId: "u-1", boardMember: true });
    renderLayout();
    expect(getDesktopSectionSlugs()).toEqual([
      "home",
      "my-place",
      "community",
      "governance",
      "requests",
    ]);
  });
});

describe("Layout single-item sections collapse to direct links", () => {
  it("renders Library and Workspace as links (no dropdown trigger button)", () => {
    mockUser = makeUser({ role: "admin" });
    renderLayout();
    const library = screen.getByTestId("nav-section-library");
    expect(library.tagName).toBe("DIV"); // wrapper around the direct link
    expect(within(library).queryByRole("button")).toBeNull();
    expect(within(library).getAllByRole("link").length).toBe(1);

    const workspace = screen.getByTestId("nav-section-workspace");
    expect(within(workspace).queryByRole("button")).toBeNull();
    expect(within(workspace).getAllByRole("link").length).toBe(1);
  });

  it("renders the resident Requests section as a direct link", () => {
    mockUser = makeUser({ role: "resident", unitId: "u-1" });
    renderLayout();
    const requests = screen.getByTestId("nav-section-requests");
    expect(within(requests).queryByRole("button")).toBeNull();
    expect(within(requests).getAllByRole("link").length).toBe(1);
  });

  it("renders multi-item sections like Property as a dropdown trigger button", () => {
    mockUser = makeUser({ role: "manager" });
    renderLayout();
    const property = screen.getByTestId("nav-section-property");
    expect(property.tagName).toBe("BUTTON");
    expect(property).toHaveAttribute("aria-haspopup", "menu");
    expect(property).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Layout dropdown open/close behavior", () => {
  beforeEach(() => {
    mockUser = makeUser({ role: "manager" });
  });

  it("clicking a section trigger opens its panel", () => {
    renderLayout();
    const trigger = screen.getByTestId("nav-section-property");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("nav-section-panel-property")).toBeInTheDocument();
  });

  it("opens only one dropdown at a time", () => {
    renderLayout();
    const property = screen.getByTestId("nav-section-property");
    const operations = screen.getByTestId("nav-section-operations");

    fireEvent.click(property);
    expect(screen.getByTestId("nav-section-panel-property")).toBeInTheDocument();
    expect(screen.queryByTestId("nav-section-panel-operations")).toBeNull();

    fireEvent.click(operations);
    expect(screen.queryByTestId("nav-section-panel-property")).toBeNull();
    expect(screen.getByTestId("nav-section-panel-operations")).toBeInTheDocument();
    expect(property).toHaveAttribute("aria-expanded", "false");
    expect(operations).toHaveAttribute("aria-expanded", "true");
  });

  it("Escape closes the open dropdown and returns focus to the trigger", () => {
    renderLayout();
    const trigger = screen.getByTestId("nav-section-financials");
    fireEvent.click(trigger);
    expect(screen.getByTestId("nav-section-panel-financials")).toBeInTheDocument();

    // Move focus into the panel first to verify Escape returns it to trigger.
    const panel = screen.getByTestId("nav-section-panel-financials");
    const items = within(panel).getAllByRole("menuitem");
    items[0].focus();
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByTestId("nav-section-panel-financials")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(trigger);
  });
});

describe("Layout active-route highlight (longest match)", () => {
  beforeEach(() => {
    mockUser = makeUser({ role: "manager" });
  });

  function activeMenuitemLabels(panel: HTMLElement): string[] {
    const items = within(panel).getAllByRole("menuitem");
    return items
      .filter((el) => (el.getAttribute("style") ?? "").toLowerCase().includes("background"))
      .map((el) => (el.textContent ?? "").trim());
  }

  it("highlights Reports (and not Amenity Financials) when at /reports", () => {
    renderLayout("/reports");
    fireEvent.click(screen.getByTestId("nav-section-financials"));
    const panel = screen.getByTestId("nav-section-panel-financials");
    expect(activeMenuitemLabels(panel)).toEqual(["Reports"]);
  });

  it("highlights Amenity Financials (and not Reports) when at /reports/amenities", () => {
    renderLayout("/reports/amenities");
    fireEvent.click(screen.getByTestId("nav-section-financials"));
    const panel = screen.getByTestId("nav-section-panel-financials");
    expect(activeMenuitemLabels(panel)).toEqual(["Amenity Financials"]);
  });
});
