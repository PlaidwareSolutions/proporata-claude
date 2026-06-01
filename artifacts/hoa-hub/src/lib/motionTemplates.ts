import type { MotionVotingRule } from "@workspace/api-client-react";

export type PayloadFieldType = "text" | "number" | "textarea";

export interface PayloadField {
  key: string;
  label: string;
  type: PayloadFieldType;
  placeholder?: string;
  required?: boolean;
  help?: string;
}

export interface MotionTemplate {
  id: string;
  label: string;
  description: string;
  kind: string;
  titlePrefix?: string;
  bodySkeleton: string;
  votingRule: MotionVotingRule;
  payloadFields?: PayloadField[];
}

export const MOTION_TEMPLATES: MotionTemplate[] = [
  {
    id: "blank",
    label: "Blank motion",
    description: "Start from scratch with no template.",
    kind: "general",
    bodySkeleton: "",
    votingRule: { type: "majority" },
  },
  {
    id: "vendor_approval",
    label: "Vendor approval (over threshold)",
    description: "Approve a vendor contract whose value exceeds the manager spending limit.",
    kind: "vendor_approval",
    titlePrefix: "Approve vendor: ",
    bodySkeleton:
      "WHEREAS the board has reviewed the attached vendor proposal,\n" +
      "WHEREAS the contracted amount exceeds the manager's standing spending authority,\n" +
      "BE IT RESOLVED that the board approves engaging the vendor named below for the scope and amount described, " +
      "and authorizes the manager to execute the contract and issue payment in accordance with the association's payment policies.\n\n" +
      "Vendor: \nScope of work: \nAmount: $\nTerm / completion: ",
    votingRule: { type: "majority" },
    payloadFields: [
      { key: "vendorName", label: "Vendor name", type: "text", required: true, placeholder: "Acme Landscaping LLC" },
      { key: "amount", label: "Amount (USD)", type: "number", required: true, placeholder: "12500" },
      { key: "scope", label: "Scope of work", type: "textarea", placeholder: "Quarterly grounds maintenance for FY..." },
      { key: "vendorRef", label: "Vendor reference / bid ID (optional)", type: "text", placeholder: "BID-2026-014" },
    ],
  },
  {
    id: "special_assessment",
    label: "Special assessment",
    description: "Levy a one-time assessment against all owners for a specific purpose.",
    kind: "special_assessment",
    titlePrefix: "Special assessment: ",
    bodySkeleton:
      "WHEREAS the board has identified a funding need that cannot be met from operating reserves,\n" +
      "BE IT RESOLVED that a special assessment is hereby levied against all owners as follows:\n\n" +
      "Purpose: \nAmount per unit: $\nTotal raise: $\nDue date(s): \nPayment plan available: yes / no\n\n" +
      "The assessment shall be billed and collected in accordance with the association's collection policy.",
    votingRule: { type: "supermajority", threshold: 2 / 3 },
    payloadFields: [
      { key: "purpose", label: "Purpose", type: "text", required: true, placeholder: "Roof replacement reserve top-up" },
      { key: "amountPerUnit", label: "Amount per unit (USD)", type: "number", required: true },
      { key: "totalRaise", label: "Total raise (USD)", type: "number" },
      { key: "dueDate", label: "Due date", type: "text", placeholder: "2026-09-01" },
    ],
  },
  {
    id: "bylaws_amendment",
    label: "Bylaws / governing-document amendment",
    description: "Amend the bylaws or covenants. Higher voting bar by default.",
    kind: "bylaws_amendment",
    titlePrefix: "Amend bylaws: ",
    bodySkeleton:
      "WHEREAS the board proposes the following amendment to the association's governing documents,\n" +
      "BE IT RESOLVED that the board adopts the amendment described below, subject to any owner ratification required by the existing bylaws.\n\n" +
      "Section affected: \nCurrent text: \nProposed text: \nRationale: \nEffective date: ",
    votingRule: { type: "supermajority", threshold: 2 / 3 },
    payloadFields: [
      { key: "section", label: "Section / article affected", type: "text", required: true, placeholder: "Article IV, §3" },
      { key: "currentText", label: "Current text", type: "textarea" },
      { key: "proposedText", label: "Proposed text", type: "textarea", required: true },
      { key: "effectiveDate", label: "Effective date", type: "text", placeholder: "2026-06-01" },
    ],
  },
  {
    id: "annual_budget",
    label: "Annual budget approval",
    description: "Adopt the operating budget for an upcoming fiscal year.",
    kind: "budget_approval",
    titlePrefix: "Adopt FY budget: ",
    bodySkeleton:
      "WHEREAS the board has reviewed the proposed operating budget for the upcoming fiscal year,\n" +
      "BE IT RESOLVED that the board adopts the attached budget and authorizes the manager to operate within its line items, " +
      "with any single-line variance exceeding 10% to be reported to the board.\n\n" +
      "Fiscal year: \nTotal operating budget: $\nReserve contribution: $\nBase monthly dues: $",
    votingRule: { type: "majority" },
    payloadFields: [
      { key: "fiscalYear", label: "Fiscal year", type: "text", required: true, placeholder: "2027" },
      { key: "totalBudget", label: "Total operating budget (USD)", type: "number", required: true },
      { key: "reserveContribution", label: "Reserve contribution (USD)", type: "number" },
      { key: "monthlyDues", label: "Base monthly dues (USD)", type: "number" },
    ],
  },
  {
    id: "reserve_expenditure",
    label: "Reserve fund expenditure",
    description: "Authorize a draw from the reserve fund for a specific capital project.",
    kind: "reserve_expenditure",
    titlePrefix: "Reserve expenditure: ",
    bodySkeleton:
      "WHEREAS the board has identified a capital need appropriately funded from reserves,\n" +
      "BE IT RESOLVED that the board authorizes the following expenditure from the reserve fund:\n\n" +
      "Project: \nAmount: $\nVendor (if known): \nReserve component drawn: \nExpected completion: ",
    votingRule: { type: "majority" },
    payloadFields: [
      { key: "project", label: "Project", type: "text", required: true },
      { key: "amount", label: "Amount (USD)", type: "number", required: true },
      { key: "reserveComponent", label: "Reserve component", type: "text", placeholder: "Roofing, paving, …" },
    ],
  },
];

export function findTemplate(id: string): MotionTemplate | undefined {
  return MOTION_TEMPLATES.find((t) => t.id === id);
}
