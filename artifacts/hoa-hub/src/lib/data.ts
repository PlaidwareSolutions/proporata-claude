import type { Status } from "./theme";

export type Building = {
  num: number;
  x: number;
  y: number;
  w: number;
  h: number;
  status: Status;
  openWO: number;
  address: string;
  street: string;
  units: number;
  yearBuilt: number;
  roofYear: number;
  insuranceStatus: "current" | "expiring" | "missing";
  notes?: string | null;
};

export type Unit = {
  id: string;
  building: number;
  unit: string;
  address: string;
  beds: number;
  baths: number;
  sqft: number;
  occupancy: "owner" | "tenant" | "vacant";
  ownerName: string;
};

export type Priority = "low" | "med" | "high" | "urgent";
export type WOStatus = "open" | "scheduled" | "in_progress" | "done";
export type WorkOrder = {
  id: string;
  building: number;
  unit?: string | null;
  title: string;
  category: "Plumbing" | "Roof" | "Electrical" | "Structural" | "Exterior" | "Landscaping" | "HVAC";
  priority: Priority;
  status: WOStatus;
  vendor?: string | null;
  opened: string;
  due?: string | null;
  estCost: number;
  description?: string | null;
};

export type Document = {
  id: string;
  name: string;
  category: "Bylaws" | "Insurance" | "Inspection" | "Financial" | "Vendor" | "Meeting";
  building?: number | null;
  unit?: string | null;
  uploaded: string;
  size: string;
  uploadedBy: string;
};

export type InsurancePolicy = {
  building: number;
  carrier: string;
  policyNo: string;
  coverage: number;
  premium: number;
  expires: string;
  status: "current" | "expiring" | "missing";
};

