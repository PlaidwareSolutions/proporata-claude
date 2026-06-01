import { Link, useLocation } from "wouter";
import { ChevronRight } from "lucide-react";
import { c } from "@/lib/theme";
import {
  useGetBuilding, useGetUnit, useGetVendor, useGetWorkOrder, useGetMeeting,
  getGetBuildingQueryKey, getGetUnitQueryKey, getGetVendorQueryKey,
  getGetWorkOrderQueryKey, getGetMeetingQueryKey,
} from "@workspace/api-client-react";

type Crumb = { label: string; href?: string };

function useDerivedCrumbs(location: string): Crumb[] {
  const segs = location.split("/").filter(Boolean);

  // Detail-route entity lookups (only one runs at a time based on `enabled`)
  const isBuildingDetail = segs[0] === "buildings" && segs[1];
  const isUnitDetail = segs[0] === "units" && segs[1];
  const isVendorDetail = segs[0] === "vendors" && segs[1];
  const isWorkOrderDetail =
    segs[0] === "work-orders" && segs[1] && segs[1] !== "new";
  const isMeetingDetail = segs[0] === "meetings" && segs[1];
  const isArchDetail =
    (segs[0] === "architectural-requests" && segs[1]) ||
    (segs[0] === "portal" && segs[1] === "architectural" && segs[2]);

  const buildingId = isBuildingDetail ? Number(segs[1]) : 0;
  const unitId = isUnitDetail ? segs[1]! : "-";
  const vendorId = isVendorDetail ? Number(segs[1]) : 0;
  const workOrderId = isWorkOrderDetail ? segs[1]! : "-";
  const meetingId = isMeetingDetail ? Number(segs[1]) : 0;
  const { data: building } = useGetBuilding(buildingId, {
    query: { enabled: !!isBuildingDetail, queryKey: getGetBuildingQueryKey(buildingId) },
  });
  const { data: unit } = useGetUnit(unitId, {
    query: { enabled: !!isUnitDetail, queryKey: getGetUnitQueryKey(unitId) },
  });
  const { data: vendor } = useGetVendor(vendorId, {
    query: { enabled: !!isVendorDetail, queryKey: getGetVendorQueryKey(vendorId) },
  });
  const { data: workOrder } = useGetWorkOrder(workOrderId, {
    query: { enabled: !!isWorkOrderDetail, queryKey: getGetWorkOrderQueryKey(workOrderId) },
  });
  const { data: meeting } = useGetMeeting(meetingId, {
    query: { enabled: !!isMeetingDetail, queryKey: getGetMeetingQueryKey(meetingId) },
  });

  if (segs.length === 0) return [];

  // Top-level label map
  const topLabels: Record<string, string> = {
    "site-map": "Site Map",
    overview: "Overview",
    reports: "Reports",
    buildings: "Buildings",
    units: "Units",
    "work-orders": "Work Orders",
    insurance: "Insurance",
    documents: "Documents",
    settings: "Settings",
    boards: "Board",
    communications: "Communications",
    "architectural-requests": "Architectural",
    billing: "Billing",
    vendors: "Vendors",
    bids: "Bids",
    motions: "Motions",
    resolutions: "Resolutions",
    pets: "Pets",
    amenities: "Amenities",
    "mail-room": "Mail Room",
    mailroom: "Mail Room",
    "ev-charging": "EV Charging",
    patrol: "Patrol",
    parking: "Guest Parking",
    fobs: "Fobs",
    "pool-tags": "Pool Tags",
    calendar: "Calendar",
    meetings: "Meetings",
    profile: "My Profile",
    portal: "My Portal",
  };

  const crumbs: Crumb[] = [];

  if (segs[0] === "portal") {
    if (segs.length === 1) return crumbs;
    const portalChildLabels: Record<string, string> = {
      architectural: "Architectural",
      account: "My Account",
      documents: "Documents",
      board: "Board",
      resolutions: "Resolutions",
      amenities: "Amenities",
      pets: "My Pets",
      mail: "My Mail",
      "ev-charging": "EV Charging",
      parking: "Guest Parking",
    };
    const childLabel = portalChildLabels[segs[1]] ?? segs[1];
    crumbs.push({
      label: childLabel,
      href: segs.length > 2 ? `/portal/${segs[1]}` : undefined,
    });
    if (segs.length > 2) {
      if (segs[1] === "architectural") {
        crumbs.push({ label: `ACC-${String(segs[2]).padStart(4, "0")}` });
      } else {
        crumbs.push({ label: segs[2]! });
      }
    }
    return crumbs;
  }

  if (segs[0] === "reports" && segs[1] === "amenities") {
    crumbs.push({ label: "Reports", href: "/reports" });
    crumbs.push({ label: "Amenity Financials" });
    return crumbs;
  }

  if (segs[0] === "billing" && segs[1] === "payments") {
    crumbs.push({ label: "Billing", href: "/billing" });
    crumbs.push({ label: "Payments" });
    return crumbs;
  }

  const top = topLabels[segs[0]!] ?? segs[0]!;
  crumbs.push({
    label: top,
    href: segs.length > 1 ? `/${segs[0]}` : undefined,
  });

  if (segs.length === 1) return crumbs;

  // Detail second segment
  if (isBuildingDetail) {
    crumbs.push({ label: building?.address ?? `Building ${segs[1]}` });
  } else if (isUnitDetail) {
    crumbs.push({ label: unit ? `Unit ${unit.unit}` : segs[1]! });
  } else if (isVendorDetail) {
    crumbs.push({ label: vendor?.name ?? `Vendor #${segs[1]}` });
  } else if (isWorkOrderDetail) {
    crumbs.push({
      label: workOrder ? `${workOrder.id} — ${workOrder.title}` : segs[1]!,
    });
  } else if (segs[0] === "work-orders" && segs[1] === "new") {
    crumbs.push({ label: "New" });
  } else if (isMeetingDetail) {
    crumbs.push({ label: meeting?.title ?? `Meeting #${segs[1]}` });
  } else if (segs[0] === "architectural-requests" && segs[1]) {
    crumbs.push({ label: `ACC-${String(segs[1]).padStart(4, "0")}` });
  } else {
    crumbs.push({ label: segs[1]! });
  }

  return crumbs;
}

export function Breadcrumbs() {
  const [location] = useLocation();
  const crumbs = useDerivedCrumbs(location);

  if (crumbs.length === 0) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1 text-[12px]"
      style={{ color: c.inkMute }}
      data-testid="breadcrumbs"
    >
      <Link
        href="/"
        className="hover:underline truncate max-w-[160px]"
        style={{ color: c.inkMute, fontWeight: 500 }}
      >
        Home
      </Link>
      {crumbs.map((c2, i) => (
        <span key={i} className="flex items-center gap-1 min-w-0">
          <ChevronRight className="h-3 w-3 shrink-0" />
          {c2.href && i < crumbs.length - 1 ? (
            <Link
              href={c2.href}
              className="hover:underline truncate max-w-[200px]"
              style={{ color: c.inkMute, fontWeight: 500 }}
            >
              {c2.label}
            </Link>
          ) : (
            <span
              className="truncate max-w-[260px]"
              style={{ color: c.inkSoft, fontWeight: 600 }}
            >
              {c2.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
