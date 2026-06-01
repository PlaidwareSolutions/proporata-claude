import { db, pool } from "./index";
import {
  buildingsTable,
  unitsTable,
  workOrdersTable,
  insurancePoliciesTable,
  documentsTable,
  organizationSettingsTable,
  documentCategoriesTable,
  vendorsTable,
  budgetsTable,
} from "./schema";

const buildingData = [
  { num: 1,  x: 80,  y: 80,  w: 70, h: 36, status: "good",   openWO: 0, address: "2801 Cambridge", street: "Cambridge Ln", units: 6, yearBuilt: 1979, roofYear: 2018, insuranceStatus: "current" },
  { num: 2,  x: 165, y: 80,  w: 70, h: 36, status: "good",   openWO: 1, address: "2803 Cambridge", street: "Cambridge Ln", units: 6, yearBuilt: 1979, roofYear: 2019, insuranceStatus: "current" },
  { num: 3,  x: 250, y: 80,  w: 70, h: 36, status: "watch",  openWO: 2, address: "2807 Yorktown",  street: "Yorktown Ln",  units: 6, yearBuilt: 1980, roofYear: 2014, insuranceStatus: "expiring" },
  { num: 4,  x: 335, y: 80,  w: 70, h: 36, status: "good",   openWO: 0, address: "2811 Yorktown",  street: "Yorktown Ln",  units: 6, yearBuilt: 1980, roofYear: 2020, insuranceStatus: "current" },
  { num: 5,  x: 420, y: 80,  w: 70, h: 36, status: "urgent", openWO: 3, address: "2814 Hampshire", street: "Hampshire Ln", units: 6, yearBuilt: 1981, roofYear: 2009, insuranceStatus: "expiring", notes: "Foundation cracks reported" },
  { num: 6,  x: 80,  y: 145, w: 70, h: 36, status: "good",   openWO: 1, address: "2818 Hampshire", street: "Hampshire Ln", units: 6, yearBuilt: 1981, roofYear: 2017, insuranceStatus: "current" },
  { num: 7,  x: 165, y: 145, w: 70, h: 36, status: "good",   openWO: 0, address: "2820 Nottingham",street: "Nottingham Ln",units: 6, yearBuilt: 1981, roofYear: 2021, insuranceStatus: "current" },
  { num: 8,  x: 250, y: 145, w: 70, h: 36, status: "watch",  openWO: 1, address: "2823 Nottingham",street: "Nottingham Ln",units: 6, yearBuilt: 1981, roofYear: 2013, insuranceStatus: "current" },
  { num: 9,  x: 335, y: 145, w: 70, h: 36, status: "urgent", openWO: 4, address: "2828 Camelot",   street: "Camelot Ln",   units: 6, yearBuilt: 1982, roofYear: 2008, insuranceStatus: "missing", notes: "Active water intrusion" },
  { num: 10, x: 420, y: 145, w: 70, h: 36, status: "good",   openWO: 0, address: "2832 Camelot",   street: "Camelot Ln",   units: 6, yearBuilt: 1982, roofYear: 2022, insuranceStatus: "current" },
  { num: 11, x: 80,  y: 230, w: 70, h: 36, status: "good",   openWO: 1, address: "2835 Princeton", street: "Princeton Ln", units: 6, yearBuilt: 1982, roofYear: 2019, insuranceStatus: "current" },
  { num: 12, x: 165, y: 230, w: 70, h: 36, status: "watch",  openWO: 2, address: "2838 Princeton", street: "Princeton Ln", units: 6, yearBuilt: 1982, roofYear: 2012, insuranceStatus: "expiring" },
  { num: 13, x: 250, y: 230, w: 70, h: 36, status: "good",   openWO: 0, address: "2841 Princess",  street: "Princess Ln",  units: 6, yearBuilt: 1983, roofYear: 2020, insuranceStatus: "current" },
  { num: 14, x: 335, y: 230, w: 70, h: 36, status: "urgent", openWO: 2, address: "2819 La Quinta", street: "La Quinta Ln", units: 6, yearBuilt: 1983, roofYear: 2010, insuranceStatus: "expiring", notes: "Inspection required" },
  { num: 15, x: 420, y: 230, w: 70, h: 36, status: "good",   openWO: 0, address: "2822 La Quinta", street: "La Quinta Ln", units: 6, yearBuilt: 1983, roofYear: 2021, insuranceStatus: "current" },
  { num: 16, x: 80,  y: 295, w: 70, h: 36, status: "good",   openWO: 1, address: "2826 La Quinta", street: "La Quinta Ln", units: 6, yearBuilt: 1983, roofYear: 2018, insuranceStatus: "current" },
  { num: 17, x: 165, y: 295, w: 70, h: 36, status: "watch",  openWO: 1, address: "2830 W Hampton", street: "W Hampton Ln", units: 6, yearBuilt: 1984, roofYear: 2013, insuranceStatus: "expiring" },
  { num: 18, x: 250, y: 295, w: 70, h: 36, status: "good",   openWO: 0, address: "2834 W Hampton", street: "W Hampton Ln", units: 6, yearBuilt: 1984, roofYear: 2020, insuranceStatus: "current" },
  { num: 19, x: 335, y: 295, w: 70, h: 36, status: "good",   openWO: 0, address: "2838 W Hampton", street: "W Hampton Ln", units: 6, yearBuilt: 1984, roofYear: 2022, insuranceStatus: "current" },
  { num: 20, x: 420, y: 295, w: 70, h: 36, status: "watch",  openWO: 1, address: "2842 Cambridge", street: "Cambridge Ln", units: 5, yearBuilt: 1984, roofYear: 2014, insuranceStatus: "expiring" },
  { num: 21, x: 80,  y: 360, w: 70, h: 36, status: "good",   openWO: 0, address: "2846 Cambridge", street: "Cambridge Ln", units: 5, yearBuilt: 1985, roofYear: 2021, insuranceStatus: "current" },
  { num: 22, x: 165, y: 360, w: 70, h: 36, status: "watch",  openWO: 1, address: "2841 Princess",  street: "Princess Ln",  units: 5, yearBuilt: 1985, roofYear: 2013, insuranceStatus: "expiring" },
  { num: 23, x: 250, y: 360, w: 70, h: 36, status: "good",   openWO: 0, address: "2845 Princess",  street: "Princess Ln",  units: 5, yearBuilt: 1985, roofYear: 2020, insuranceStatus: "current" },
  { num: 24, x: 335, y: 360, w: 70, h: 36, status: "good",   openWO: 1, address: "2849 Camelot",   street: "Camelot Ln",   units: 5, yearBuilt: 1985, roofYear: 2019, insuranceStatus: "current" },
  { num: 25, x: 420, y: 360, w: 70, h: 36, status: "good",   openWO: 0, address: "2853 Camelot",   street: "Camelot Ln",   units: 5, yearBuilt: 1985, roofYear: 2022, insuranceStatus: "current" },
] as const;

const occList = ["owner", "owner", "tenant", "owner", "tenant", "vacant"] as const;
const ownerNames = ["Hayes", "Patel", "Nguyen", "Garcia", "Williams", "Chen", "Adams", "Brooks", "Rivera", "Singh", "Cohen", "Davis", "Foster", "Kim", "Lopez", "Murphy", "Reed", "Stone", "Tran", "Vargas", "Wright", "Young", "Zhao", "Bell", "Cole", "Doyle"];

const unitData = buildingData.flatMap((b) =>
  Array.from({ length: b.units }, (_, i) => ({
    id: `${b.num}-${String.fromCharCode(65 + i)}`,
    building: b.num,
    unit: String.fromCharCode(65 + i),
    address: `${b.address} #${String.fromCharCode(65 + i)}`,
    beds: 2 + ((b.num + i) % 2),
    baths: 1.5 + ((b.num + i) % 2) * 0.5,
    sqft: 1100 + ((b.num * 7 + i * 23) % 9) * 60,
    occupancy: occList[(b.num + i) % occList.length] as "owner" | "tenant" | "vacant",
    ownerName: ownerNames[(b.num * 3 + i * 5) % ownerNames.length]!,
  })),
);

const vendorData = [
  { id: 1, name: "Quail Plumbing Co",   tradeCategory: "Plumbing",   contactName: "Ray Delgado",    phone: "(512) 555-0142", email: "ray@quailplumbing.com",      licenseNumber: "TX-PL-44821", status: "active",   notes: "Preferred plumber; 24-hr emergency line available" },
  { id: 2, name: "Apex Roofing",        tradeCategory: "Roof",       contactName: "Sandra Kowalski",phone: "(512) 555-0287", email: "sandra@apexroofing.net",     licenseNumber: "TX-RC-19034", status: "active",   notes: "Handles all common-area roofing; warranty on labor" },
  { id: 3, name: "Pier & Beam LLC",     tradeCategory: "Structural", contactName: "Marcus Webb",    phone: "(737) 555-0361", email: "marcus@pierbeam.com",        licenseNumber: "TX-SE-77210", status: "active",   notes: "Foundation specialist; inspection reports provided" },
  { id: 4, name: "Cool Tex HVAC",       tradeCategory: "HVAC",       contactName: "Lisa Tran",      phone: "(512) 555-0415", email: "lisa@cooltexhvac.com",       licenseNumber: "TX-AC-30156", status: "active",   notes: "Covers all HVAC maintenance and replacement" },
  { id: 5, name: "Overhead Solutions",  tradeCategory: "Exterior",   contactName: "Brian Okafor",   phone: "(512) 555-0538", email: "brian@overheadsolutions.com",licenseNumber: null,          status: "active",   notes: "Garage doors and gate operators" },
  { id: 6, name: "Lonestar Fence",      tradeCategory: "Exterior",   contactName: "Donna Rios",     phone: "(512) 555-0629", email: "donna@lonestarf.com",        licenseNumber: null,          status: "active",   notes: "Wood and metal fencing, storm repair specialist" },
];

const workOrderData = [
  { id: "WO-1042", building: 9,  unit: "9-B",  title: "Active water intrusion in master closet", category: "Plumbing",   priority: "urgent", status: "in_progress", vendor: "Quail Plumbing Co",  vendorId: 1, opened: "2026-04-29", due: "2026-05-03", estCost: 2400 },
  { id: "WO-1041", building: 5,  unit: null,    title: "Foundation crack — east elevation",        category: "Structural", priority: "urgent", status: "open",        vendor: "Pier & Beam LLC",    vendorId: 3, opened: "2026-04-28", due: "2026-05-04", estCost: 9800 },
  { id: "WO-1040", building: 14, unit: null,    title: "Roof inspection required after wind event",category: "Roof",       priority: "urgent", status: "scheduled",   vendor: "Apex Roofing",       vendorId: 2, opened: "2026-04-27", due: "2026-05-02", estCost: 850 },
  { id: "WO-1039", building: 5,  unit: "5-C",  title: "Bathroom GFCI tripping repeatedly",        category: "Electrical", priority: "high",   status: "open",        vendor: null,                 vendorId: null, opened: "2026-04-26", estCost: 320 },
  { id: "WO-1038", building: 9,  unit: "9-A",  title: "Garage door opener replacement",           category: "Exterior",   priority: "med",    status: "scheduled",   vendor: "Overhead Solutions", vendorId: 5, opened: "2026-04-25", due: "2026-05-08", estCost: 480 },
  { id: "WO-1037", building: 9,  unit: "9-D",  title: "Kitchen sink slow drain",                  category: "Plumbing",   priority: "med",    status: "open",        vendor: null,                 vendorId: null, opened: "2026-04-24", estCost: 180 },
  { id: "WO-1036", building: 9,  unit: "9-F",  title: "HVAC condenser replacement",               category: "HVAC",       priority: "high",   status: "in_progress", vendor: "Cool Tex HVAC",      vendorId: 4, opened: "2026-04-23", due: "2026-05-05", estCost: 3200 },
  { id: "WO-1035", building: 5,  unit: "5-A",  title: "Front door weatherstripping",              category: "Exterior",   priority: "low",    status: "scheduled",   vendor: null,                 vendorId: null, opened: "2026-04-22", due: "2026-05-12", estCost: 90 },
  { id: "WO-1034", building: 14, unit: "14-B", title: "Fence panel storm damage",                 category: "Exterior",   priority: "med",    status: "scheduled",   vendor: "Lonestar Fence",     vendorId: 6, opened: "2026-04-22", due: "2026-05-09", estCost: 420 },
  { id: "WO-1033", building: 3,  unit: null,    title: "Common area irrigation valve",             category: "Landscaping",priority: "med",    status: "open",        vendor: null,                 vendorId: null, opened: "2026-04-21", estCost: 260 },
  { id: "WO-1032", building: 12, unit: null,    title: "Roof flashing — minor leak observed",      category: "Roof",       priority: "high",   status: "scheduled",   vendor: "Apex Roofing",       vendorId: 2, opened: "2026-04-20", due: "2026-05-06", estCost: 740 },
  { id: "WO-1031", building: 12, unit: "12-E", title: "Window seal failure",                      category: "Exterior",   priority: "low",    status: "open",        vendor: null,                 vendorId: null, opened: "2026-04-19", estCost: 210 },
  { id: "WO-1030", building: 17, unit: null,    title: "Mailbox kiosk lighting out",               category: "Electrical", priority: "low",    status: "scheduled",   vendor: null,                 vendorId: null, opened: "2026-04-18", due: "2026-05-10", estCost: 95 },
  { id: "WO-1029", building: 8,  unit: null,    title: "Tree trim — east boundary",                category: "Landscaping",priority: "med",    status: "open",        vendor: null,                 vendorId: null, opened: "2026-04-17", estCost: 540 },
  { id: "WO-1028", building: 22, unit: "22-C", title: "Kitchen faucet replacement",               category: "Plumbing",   priority: "low",    status: "scheduled",   vendor: null,                 vendorId: null, opened: "2026-04-17", due: "2026-05-11", estCost: 165 },
  { id: "WO-1027", building: 20, unit: null,    title: "Sidewalk concrete heave",                  category: "Structural", priority: "med",    status: "open",        vendor: null,                 vendorId: null, opened: "2026-04-16", estCost: 1100 },
  { id: "WO-1026", building: 2,  unit: "2-F",  title: "Smoke detector batteries — annual",        category: "Electrical", priority: "low",    status: "done",        vendor: null,                 vendorId: null, opened: "2026-04-10", estCost: 40 },
  { id: "WO-1025", building: 6,  unit: "6-A",  title: "Patio gate hinge repair",                  category: "Exterior",   priority: "low",    status: "done",        vendor: null,                 vendorId: null, opened: "2026-04-08", estCost: 75 },
  { id: "WO-1024", building: 11, unit: "11-C", title: "Disposal motor replacement",               category: "Plumbing",   priority: "med",    status: "done",        vendor: "Quail Plumbing Co",  vendorId: 1, opened: "2026-04-05", estCost: 220 },
  { id: "WO-1023", building: 24, unit: "24-D", title: "Attic insulation top-up",                  category: "Structural", priority: "low",    status: "done",        vendor: null,                 vendorId: null, opened: "2026-04-02", estCost: 680 },
  { id: "WO-1022", building: 16, unit: "16-B", title: "AC drain line cleared",                    category: "HVAC",       priority: "med",    status: "done",        vendor: "Cool Tex HVAC",      vendorId: 4, opened: "2026-03-30", estCost: 130 },
];

const carriers = ["State Farm", "Travelers", "Allstate", "Chubb", "Liberty Mutual"];
const today = new Date("2026-05-02");

const insuranceData = buildingData.map((b) => {
  let expires: string;
  if (b.insuranceStatus === "missing") {
    expires = "—";
  } else if (b.insuranceStatus === "expiring") {
    const d = new Date(today);
    d.setDate(d.getDate() + 18 + (b.num % 12));
    expires = d.toISOString().slice(0, 10);
  } else {
    const d = new Date(today);
    d.setDate(d.getDate() + 180 + (b.num * 7) % 120);
    expires = d.toISOString().slice(0, 10);
  }
  return {
    building: b.num,
    carrier: carriers[b.num % carriers.length]!,
    policyNo: `QV-2026-${String(b.num).padStart(3, "0")}`,
    coverage: 1_200_000 + (b.num % 7) * 100_000,
    premium: 8_400 + (b.num % 11) * 220,
    expires,
    status: b.insuranceStatus as "current" | "expiring" | "missing",
  };
});

const inspectionDates = [
  "2026-01-15", "2026-01-22", "2026-02-03", "2026-02-10", "2026-02-18",
  "2026-02-25", "2026-03-05", "2026-03-12", "2026-03-18", "2026-03-24",
  "2026-03-28", "2026-04-02", "2026-04-07", "2026-04-08", "2026-04-10",
  "2026-04-11", "2026-04-13", "2026-04-14", "2026-04-15", "2026-04-16",
  "2026-04-17", "2026-04-18", "2026-04-19", "2026-04-20", "2026-04-21",
];

const insuranceDates = [
  "2026-01-10", "2026-01-17", "2026-01-24", "2026-02-01", "2026-02-08",
  "2026-02-15", "2026-02-22", "2026-03-01", "2026-03-08", "2026-03-15",
  "2026-03-22", "2026-03-29", "2026-04-01", "2026-04-03", "2026-04-05",
  "2026-04-06", "2026-04-07", "2026-04-08", "2026-04-09", "2026-04-10",
  "2026-04-11", "2026-04-12", "2026-04-13", "2026-04-14", "2026-04-15",
];

const inspectorNames = ["Apex Roofing", "Piedmont Inspections", "Quail Valley Inspectors", "Southwest Inspection Svc", "Premier Property Inspect"];

const buildingDocumentData = buildingData.flatMap((b) => {
  const inspDate = inspectionDates[b.num - 1]!;
  const insDate = insuranceDates[b.num - 1]!;
  const inspector = inspectorNames[(b.num - 1) % inspectorNames.length]!;
  const sizeMB = (1.2 + ((b.num * 7) % 9) * 0.4).toFixed(1);
  const insSize = (0.6 + ((b.num * 3) % 8) * 0.2).toFixed(1);
  return [
    {
      id: `D-INSP-${b.num}`,
      name: `Roof Inspection Report — Bldg ${String(b.num).padStart(2, "0")}.pdf`,
      category: "Inspection" as const,
      building: b.num,
      uploaded: inspDate,
      size: `${sizeMB} MB`,
      uploadedBy: inspector,
      storageKey: null,
      driveFileId: null,
    },
    {
      id: `D-INS-${b.num}`,
      name: `Insurance Certificate — Bldg ${String(b.num).padStart(2, "0")} ${carriers[b.num % carriers.length]}.pdf`,
      category: "Insurance" as const,
      building: b.num,
      uploaded: insDate,
      size: `${insSize} MB`,
      uploadedBy: "M. Hayes",
      storageKey: null,
      driveFileId: null,
    },
  ];
});

const completedWODocumentData = workOrderData
  .filter((w) => w.status === "done")
  .map((w) => ({
    id: `D-WO-${w.id}`,
    name: `Completion Report — ${w.title.substring(0, 40)}.pdf`,
    category: "Vendor" as const,
    building: w.building,
    uploaded: w.opened,
    size: `${(0.3 + (parseInt(w.id.replace("WO-", "")) % 8) * 0.1).toFixed(1)} MB`,
    uploadedBy: "vendor" in w ? (w.vendor as string) : "M. Hayes",
    storageKey: null,
    driveFileId: null,
  }));

const coreDocumentData = [
  { id: "D-201", name: "2026 Master Insurance Binder.pdf",        category: "Insurance" as const,  building: null as number | null, uploaded: "2026-04-12", size: "2.4 MB", uploadedBy: "M. Hayes", storageKey: null, driveFileId: null },
  { id: "D-200", name: "Q1 2026 Financial Statement.pdf",          category: "Financial" as const,  building: null,                  uploaded: "2026-04-10", size: "1.1 MB", uploadedBy: "Treasurer", storageKey: null, driveFileId: null },
  { id: "D-199", name: "Roof Inspection — Bldg 14.pdf",            category: "Inspection" as const, building: 14,                    uploaded: "2026-04-08", size: "3.8 MB", uploadedBy: "Apex Roofing", storageKey: null, driveFileId: null },
  { id: "D-198", name: "April Board Meeting Minutes.pdf",          category: "Meeting" as const,    building: null,                  uploaded: "2026-04-06", size: "320 KB", uploadedBy: "Secretary", storageKey: null, driveFileId: null },
  { id: "D-197", name: "Quail Plumbing — Vendor Agreement.pdf",    category: "Vendor" as const,     building: null,                  uploaded: "2026-03-29", size: "880 KB", uploadedBy: "Manager", storageKey: null, driveFileId: null },
  { id: "D-196", name: "Foundation Report — Bldg 5.pdf",           category: "Inspection" as const, building: 5,                     uploaded: "2026-03-22", size: "5.2 MB", uploadedBy: "Pier & Beam LLC", storageKey: null, driveFileId: null },
  { id: "D-195", name: "Updated CC&Rs — 2026 Revision.pdf",        category: "Bylaws" as const,     building: null,                  uploaded: "2026-03-15", size: "1.7 MB", uploadedBy: "Legal", storageKey: null, driveFileId: null },
  { id: "D-194", name: "Bldg 9 Water Loss Claim.pdf",              category: "Insurance" as const,  building: 9,                     uploaded: "2026-03-10", size: "640 KB", uploadedBy: "M. Hayes", storageKey: null, driveFileId: null },
  { id: "D-193", name: "Annual Reserve Study.pdf",                 category: "Financial" as const,  building: null,                  uploaded: "2026-02-28", size: "4.1 MB", uploadedBy: "Treasurer", storageKey: null, driveFileId: null },
  { id: "D-192", name: "March Board Meeting Minutes.pdf",          category: "Meeting" as const,    building: null,                  uploaded: "2026-03-04", size: "298 KB", uploadedBy: "Secretary", storageKey: null, driveFileId: null },
  { id: "D-BYLAWS", name: "Quail Valley HOA — Bylaws & Governing Documents 2024.pdf", category: "Bylaws" as const, building: null, uploaded: "2024-11-01", size: "3.2 MB", uploadedBy: "Legal", storageKey: null, driveFileId: null },
];

const allDocumentData = [
  ...coreDocumentData,
  ...buildingDocumentData,
  ...completedWODocumentData,
];

const defaultCategories = [
  "Work Orders",
  "Insurance",
  "Correspondence",
  "Roof Documents",
  "Financial",
  "Vendor Agreements",
  "Bylaws & Governing Docs",
];

async function seed() {
  console.log("Seeding database…");

  console.log("Inserting buildings…");
  await db
    .insert(buildingsTable)
    .values(buildingData.map((b) => ({ ...b, notes: "notes" in b ? b.notes : null })))
    .onConflictDoNothing();

  console.log("Inserting units…");
  await db.insert(unitsTable).values(unitData).onConflictDoNothing();

  console.log("Deleting and re-inserting vendors…");
  await db.delete(vendorsTable);
  await db.insert(vendorsTable).values(
    vendorData.map((v) => ({
      id: v.id,
      name: v.name,
      tradeCategory: v.tradeCategory,
      contactName: v.contactName,
      phone: v.phone,
      email: v.email,
      licenseNumber: v.licenseNumber,
      status: v.status,
      notes: v.notes,
    })),
  );

  console.log("Deleting and re-inserting work orders…");
  await db.delete(workOrdersTable);
  await db
    .insert(workOrdersTable)
    .values(
      workOrderData.map((w) => ({
        id: w.id,
        building: w.building,
        unit: w.unit ?? null,
        title: w.title,
        category: w.category,
        priority: w.priority,
        status: w.status,
        vendor: w.vendor ?? null,
        vendorId: w.vendorId ?? null,
        opened: w.opened,
        due: "due" in w ? (w.due as string) : null,
        estCost: w.estCost,
        description: null,
      })),
    );

  console.log("Inserting insurance policies…");
  await db.insert(insurancePoliciesTable).values(insuranceData).onConflictDoNothing();

  console.log("Inserting documents…");
  await db
    .insert(documentsTable)
    .values(allDocumentData)
    .onConflictDoNothing();

  console.log("Inserting organization settings…");
  await db
    .insert(organizationSettingsTable)
    .values({
      id: 1,
      name: "Quail Valley HOA",
      address: null,
      contactEmail: "manager@quailvalleyhoa.org",
      phone: null,
      timezone: "America/Chicago",
      notificationPreferences: { urgent: true, expiring: true, weekly: false },
    })
    .onConflictDoNothing();

  console.log("Inserting per-category annual budgets…");
  const nowIso = new Date().toISOString();
  const fiscalYear = new Date().getFullYear();
  const budgetData = [
    { category: "Plumbing",    amount: 4000 },
    { category: "Roof",        amount: 8000 },
    { category: "Structural",  amount: 12000 },
    { category: "HVAC",        amount: 6000 },
    { category: "Electrical",  amount: 2000 },
    { category: "Exterior",    amount: 3000 },
    { category: "Landscaping", amount: 4000 },
  ];
  await db
    .insert(budgetsTable)
    .values(
      budgetData.map((b) => ({
        category: b.category,
        fiscalYear,
        amount: b.amount,
        notes: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      })),
    )
    .onConflictDoNothing();

  console.log("Inserting document categories…");
  await db
    .insert(documentCategoriesTable)
    .values(defaultCategories.map((name, i) => ({ name, sortOrder: i })))
    .onConflictDoNothing();

  console.log(`Seed complete! ${allDocumentData.length} documents inserted.`);
  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
