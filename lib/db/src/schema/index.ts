import { pgTable, text, integer, serial, doublePrecision, jsonb, unique, boolean, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const buildingsTable = pgTable("buildings", {
  num: integer("num").primaryKey(),
  x: integer("x").notNull(),
  y: integer("y").notNull(),
  w: integer("w").notNull(),
  h: integer("h").notNull(),
  status: text("status").notNull(),
  openWO: integer("open_wo").notNull().default(0),
  address: text("address").notNull(),
  street: text("street").notNull(),
  units: integer("units").notNull(),
  yearBuilt: integer("year_built").notNull(),
  roofYear: integer("roof_year").notNull(),
  insuranceStatus: text("insurance_status").notNull(),
  notes: text("notes"),
  driveFolderId: text("drive_folder_id"),
  driveSharedFolderId: text("drive_shared_folder_id"),
  driveSubfolderIds: jsonb("drive_subfolder_ids").$type<Record<string, string>>(),
});

export const insertBuildingSchema = createInsertSchema(buildingsTable);
export type InsertBuilding = z.infer<typeof insertBuildingSchema>;
export type Building = typeof buildingsTable.$inferSelect;

export const unitsTable = pgTable("units", {
  id: text("id").primaryKey(),
  building: integer("building")
    .notNull()
    .references(() => buildingsTable.num),
  unit: text("unit").notNull(),
  address: text("address").notNull(),
  beds: integer("beds").notNull(),
  baths: doublePrecision("baths").notNull(),
  sqft: integer("sqft").notNull(),
  occupancy: text("occupancy").notNull(),
  ownerName: text("owner_name").notNull(),
  ownerPhone: text("owner_phone"),
  ownerEmail: text("owner_email"),
  ownerMailingAddress: text("owner_mailing_address"),
  ownerEmergencyName: text("owner_emergency_name"),
  ownerEmergencyPhone: text("owner_emergency_phone"),
  tenantName: text("tenant_name"),
  tenantPhone: text("tenant_phone"),
  tenantEmail: text("tenant_email"),
  tenantEmergencyName: text("tenant_emergency_name"),
  tenantEmergencyPhone: text("tenant_emergency_phone"),
  driveFolderId: text("drive_folder_id"),
  driveSubfolderIds: jsonb("drive_subfolder_ids").$type<Record<string, string>>(),
});

export const insertUnitSchema = createInsertSchema(unitsTable);
export type InsertUnit = z.infer<typeof insertUnitSchema>;
export type Unit = typeof unitsTable.$inferSelect;

export const vendorsTable = pgTable("vendors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  tradeCategory: text("trade_category").notNull(),
  contactName: text("contact_name").notNull(),
  phone: text("phone").notNull(),
  email: text("email").notNull(),
  licenseNumber: text("license_number"),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
});

export const insertVendorSchema = createInsertSchema(vendorsTable).omit({ id: true });
export type InsertVendor = z.infer<typeof insertVendorSchema>;
export type Vendor = typeof vendorsTable.$inferSelect;

export const workOrdersTable = pgTable("work_orders", {
  id: text("id").primaryKey(),
  building: integer("building")
    .notNull()
    .references(() => buildingsTable.num),
  unit: text("unit").references(() => unitsTable.id),
  title: text("title").notNull(),
  category: text("category").notNull(),
  priority: text("priority").notNull(),
  status: text("status").notNull(),
  vendor: text("vendor"),
  vendorId: integer("vendor_id").references(() => vendorsTable.id),
  opened: text("opened").notNull(),
  due: text("due"),
  estCost: integer("est_cost").notNull().default(0),
  description: text("description"),
  sourceBidId: integer("source_bid_id"),
  sourceMotionId: integer("source_motion_id"),
  emergencyBypassId: integer("emergency_bypass_id"),
  resolutionId: integer("resolution_id"),
  // Task #119: historical work orders represent past, completed work logged
  // after the fact for record-keeping. They are excluded from current
  // operational metrics (active counts, SLA, monthly opened/spend trends) but
  // are included in lifetime/per-building/per-unit history rollups.
  historical: boolean("historical").notNull().default(false),
  completedOn: text("completed_on"),
  actualCost: integer("actual_cost"),
  historicalVendorName: text("historical_vendor_name"),
  historicalNotes: text("historical_notes"),
});

export const insertWorkOrderSchema = createInsertSchema(workOrdersTable).omit({ id: true });
export type InsertWorkOrder = z.infer<typeof insertWorkOrderSchema>;
export type WorkOrder = typeof workOrdersTable.$inferSelect;

export const workOrderAttachmentsTable = pgTable("work_order_attachments", {
  id: serial("id").primaryKey(),
  workOrderId: text("work_order_id")
    .notNull()
    .references(() => workOrdersTable.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  name: text("name"),
  uploadedBy: integer("uploaded_by"),
  uploadedAt: text("uploaded_at").notNull(),
});

export type WorkOrderAttachment = typeof workOrderAttachmentsTable.$inferSelect;

export const workOrderEventsTable = pgTable("work_order_events", {
  id: serial("id").primaryKey(),
  workOrderId: text("work_order_id")
    .notNull()
    .references(() => workOrdersTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  actorUserId: integer("actor_user_id"),
  actorName: text("actor_name"),
  payload: jsonb("payload"),
  createdAt: text("created_at").notNull(),
  editedAt: text("edited_at"),
  deletedAt: text("deleted_at"),
  originalPayload: jsonb("original_payload"),
});

export type WorkOrderEvent = typeof workOrderEventsTable.$inferSelect;

export const insurancePoliciesTable = pgTable("insurance_policies", {
  id: serial("id").primaryKey(),
  building: integer("building")
    .notNull()
    .references(() => buildingsTable.num)
    .unique(),
  carrier: text("carrier").notNull(),
  policyNo: text("policy_no").notNull(),
  coverage: integer("coverage").notNull(),
  premium: integer("premium").notNull(),
  expires: text("expires").notNull(),
  status: text("status").notNull(),
  // Task #120: tracks when the current policy began so prior-policy
  // rollover can record an accurate effective_to date.
  effectiveFrom: text("effective_from"),
});

export const insertInsurancePolicySchema = createInsertSchema(insurancePoliciesTable).omit({ id: true });
export type InsertInsurancePolicy = z.infer<typeof insertInsurancePolicySchema>;
export type InsurancePolicy = typeof insurancePoliciesTable.$inferSelect;

// Task #120: previous-year insurance policies. When the current policy is
// replaced (carrier or policyNo changes), the row in `insurance_policies` is
// moved here as a closed period.
export const insurancePolicyHistoryTable = pgTable("insurance_policy_history", {
  id: serial("id").primaryKey(),
  building: integer("building").notNull().references(() => buildingsTable.num),
  carrier: text("carrier").notNull(),
  policyNo: text("policy_no").notNull(),
  coverage: integer("coverage").notNull(),
  premium: integer("premium").notNull(),
  effectiveFrom: text("effective_from").notNull(),
  effectiveTo: text("effective_to").notNull(),
  endedReason: text("ended_reason"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

export type InsurancePolicyHistory = typeof insurancePolicyHistoryTable.$inferSelect;

export const insurancePolicyHistoryDocumentsTable = pgTable("insurance_policy_history_documents", {
  id: serial("id").primaryKey(),
  historyId: integer("history_id").notNull().references(() => insurancePolicyHistoryTable.id, { onDelete: "cascade" }),
  documentId: text("document_id").notNull(),
  kind: text("kind").notNull().default("other"), // declaration | coi | renewal | claim | other
  createdAt: text("created_at").notNull(),
});

export type InsurancePolicyHistoryDocument = typeof insurancePolicyHistoryDocumentsTable.$inferSelect;

export const documentsTable = pgTable("documents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  building: integer("building").references(() => buildingsTable.num),
  unit: text("unit").references(() => unitsTable.id),
  uploaded: text("uploaded").notNull(),
  size: text("size").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  storageKey: text("storage_key"),
  driveFileId: text("drive_file_id"),
  // Task #119: historical document metadata.
  documentDate: text("document_date"),
  isHistorical: boolean("is_historical").notNull().default(false),
  source: text("source").notNull().default("original"),
  importBatchId: text("import_batch_id"),
  notes: text("notes"),
  // Task #120: optional vendor tag for the unified vendor file room.
  vendorId: integer("vendor_id"),
  workOrderId: text("work_order_id"),
  // Task #121: full-text extracted by OCR for search.
  extractedText: text("extracted_text"),
});

export const insertDocumentSchema = createInsertSchema(documentsTable);
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;

// Task #119: groups documents that were bulk-imported together so an
// administrator can review or roll back the entire upload set within 24 hours.
export const documentImportBatchesTable = pgTable("document_import_batches", {
  id: text("id").primaryKey(),
  label: text("label"),
  status: text("status").notNull().default("committed"),
  fileCount: integer("file_count").notNull().default(0),
  defaultCategory: text("default_category"),
  defaultBuilding: integer("default_building"),
  defaultUnit: text("default_unit"),
  defaultSource: text("default_source").notNull().default("imported"),
  defaultIsHistorical: boolean("default_is_historical").notNull().default(true),
  createdBy: integer("created_by"),
  createdByName: text("created_by_name"),
  createdAt: text("created_at").notNull(),
  undoneAt: text("undone_at"),
  undoneBy: integer("undone_by"),
  undoneByName: text("undone_by_name"),
  notes: text("notes"),
});

export type DocumentImportBatch = typeof documentImportBatchesTable.$inferSelect;

export const organizationSettingsTable = pgTable("organization_settings", {
  id: integer("id").primaryKey().default(1),
  name: text("name").notNull().default(""),
  address: text("address"),
  contactEmail: text("contact_email"),
  phone: text("phone"),
  timezone: text("timezone").notNull().default("America/Chicago"),
  notificationPreferences: jsonb("notification_preferences"),
  accEnabled: boolean("acc_enabled").notNull().default(true),
  accQuorumMode: text("acc_quorum_mode").notNull().default("any"),
  accAutoApprovalDays: integer("acc_auto_approval_days").notNull().default(0),
  bidMinQuotesThresholdCents: integer("bid_min_quotes_threshold_cents").notNull().default(0),
  bidDefaultSealed: boolean("bid_default_sealed").notNull().default(false),
  bidReminderDaysBefore: integer("bid_reminder_days_before").notNull().default(3),
  paymentsEnabled: boolean("payments_enabled").notNull().default(false),
  paymentsSurchargeEnabled: boolean("payments_surcharge_enabled").notNull().default(false),
  paymentsSurchargePercentBp: integer("payments_surcharge_percent_bp").notNull().default(0),
  paymentsAutoPayLagDays: integer("payments_auto_pay_lag_days").notNull().default(3),
  expenditureThresholdCents: integer("expenditure_threshold_cents").notNull().default(0),
  gatedPolicies: jsonb("gated_policies").$type<string[]>().notNull().default([]),
  emergencyBypassEnabled: boolean("emergency_bypass_enabled").notNull().default(false),
  // Task #65: meeting governance defaults.
  meetingNoticeOpenDays: integer("meeting_notice_open_days").notNull().default(3),
  meetingNoticeExecutiveDays: integer("meeting_notice_executive_days").notNull().default(2),
  meetingNoticeAnnualDays: integer("meeting_notice_annual_days").notNull().default(30),
  meetingQuorumMode: text("meeting_quorum_mode").notNull().default("majority"),
  meetingQuorumPercentBp: integer("meeting_quorum_percent_bp").notNull().default(5000),
  // OCR auto-tag suggestion settings for the bulk historical-document importer.
  ocrEnabled: boolean("ocr_enabled").notNull().default(true),
  ocrDailyPageCap: integer("ocr_daily_page_cap").notNull().default(1000),
  // Task #139 — Days an owner can be past-due before their voting rights
  // are suspended ("not in good standing"). Used to derive
  // owner_accounts.ownership_status. Default 60 days.
  pastDueVotingThresholdDays: integer("past_due_voting_threshold_days").notNull().default(60),
  // Task #146: org-wide "welcome tour" version. Admins bump this after a
  // significant release; users whose `user_onboarding.tour_version_seen` is
  // below this number will see the tour again on next load. Replay state is
  // preserved per user (the server stamps the user's seen version when they
  // dismiss the tour, so they will not see it again until the next bump).
  currentTourVersion: integer("current_tour_version").notNull().default(1),
});

// OCR job queue for the bulk historical-document importer. Each
// staged upload (keyed by storageKey) gets one row; the scheduler picks up
// queued jobs, calls the OCR provider, runs heuristic auto-tag suggestions,
// and writes the results back. Suggestions are read by the importer preview
// and (on commit) the full text is copied onto the document for search.
export type OcrJobStatus = "queued" | "processing" | "completed" | "failed" | "skipped";

export const documentOcrJobsTable = pgTable("document_ocr_jobs", {
  id: serial("id").primaryKey(),
  storageKey: text("storage_key").notNull().unique(),
  fileName: text("file_name").notNull().default(""),
  contentType: text("content_type"),
  status: text("status").$type<OcrJobStatus>().notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  // { category, documentDate, vendor, building, unit } each with confidence + snippet.
  suggestions: jsonb("suggestions"),
  fullText: text("full_text"),
  pageCount: integer("page_count").notNull().default(0),
  enqueuedBy: integer("enqueued_by"),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
});

export type DocumentOcrJob = typeof documentOcrJobsTable.$inferSelect;

export const architecturalRequestsTable = pgTable("architectural_requests", {
  id: serial("id").primaryKey(),
  unitId: text("unit_id").notNull().references(() => unitsTable.id),
  building: integer("building").notNull().references(() => buildingsTable.num),
  ownerUserId: integer("owner_user_id").notNull().references(() => usersTable.id),
  ownerName: text("owner_name").notNull().default(""),
  projectType: text("project_type").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  contractorName: text("contractor_name"),
  plannedStart: text("planned_start"),
  plannedEnd: text("planned_end"),
  acknowledgedGuidelines: boolean("acknowledged_guidelines").notNull().default(false),
  status: text("status").notNull().default("submitted"),
  submittedAt: text("submitted_at").notNull(),
  decidedAt: text("decided_at"),
  decisionText: text("decision_text"),
  conditionsText: text("conditions_text"),
  decisionLetterStorageKey: text("decision_letter_storage_key"),
  autoApprovalFlagged: boolean("auto_approval_flagged").notNull().default(false),
  autoApprovalFlaggedAt: text("auto_approval_flagged_at"),
  resolutionId: integer("resolution_id"),
});

export const insertArchitecturalRequestSchema = createInsertSchema(architecturalRequestsTable).omit({ id: true });
export type InsertArchitecturalRequest = z.infer<typeof insertArchitecturalRequestSchema>;
export type ArchitecturalRequest = typeof architecturalRequestsTable.$inferSelect;

export const accAttachmentsTable = pgTable("acc_attachments", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull().references(() => architecturalRequestsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  size: integer("size").notNull().default(0),
  contentType: text("content_type"),
  storageKey: text("storage_key").notNull(),
  kind: text("kind").notNull().default("photo"),
  uploadedByUserId: integer("uploaded_by_user_id").notNull().references(() => usersTable.id),
  uploadedByName: text("uploaded_by_name").notNull().default(""),
  uploadedAt: text("uploaded_at").notNull(),
});

export const insertAccAttachmentSchema = createInsertSchema(accAttachmentsTable).omit({ id: true });
export type AccAttachment = typeof accAttachmentsTable.$inferSelect;

export const accEventsTable = pgTable("acc_events", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull().references(() => architecturalRequestsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  authorUserId: integer("author_user_id").references(() => usersTable.id),
  authorName: text("author_name").notNull().default(""),
  authorRole: text("author_role"),
  body: text("body"),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  voteValue: text("vote_value"),
  createdAt: text("created_at").notNull(),
});

export const insertAccEventSchema = createInsertSchema(accEventsTable).omit({ id: true });
export type AccEvent = typeof accEventsTable.$inferSelect;

export const insertOrganizationSettingsSchema = createInsertSchema(organizationSettingsTable);
export type InsertOrganizationSettings = z.infer<typeof insertOrganizationSettingsSchema>;
export type OrganizationSettings = typeof organizationSettingsTable.$inferSelect;

export const documentCategoriesTable = pgTable("document_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertDocumentCategorySchema = createInsertSchema(documentCategoriesTable).omit({ id: true });
export type InsertDocumentCategory = z.infer<typeof insertDocumentCategorySchema>;
export type DocumentCategory = typeof documentCategoriesTable.$inferSelect;

export const mapMarkersTable = pgTable("map_markers", {
  id: serial("id").primaryKey(),
  buildingNum: integer("building_num").notNull().references(() => buildingsTable.num),
  view: text("view").notNull(),
  left: doublePrecision("left").notNull(),
  top: doublePrecision("top").notNull(),
}, (t) => [unique().on(t.buildingNum, t.view)]);

export const insertMapMarkerSchema = createInsertSchema(mapMarkersTable).omit({ id: true });
export type InsertMapMarker = z.infer<typeof insertMapMarkerSchema>;
export type MapMarker = typeof mapMarkersTable.$inferSelect;

export const userNotificationPreferencesTable = pgTable("user_notification_preferences", {
  userId: text("user_id").primaryKey(),
  urgent: integer("urgent").notNull().default(1),
  expiring: integer("expiring").notNull().default(1),
  weekly: integer("weekly").notNull().default(0),
  workOrdersInApp: integer("work_orders_in_app").notNull().default(1),
  workOrdersEmail: integer("work_orders_email").notNull().default(1),
  announcementsInApp: integer("announcements_in_app").notNull().default(1),
  announcementsEmail: integer("announcements_email").notNull().default(1),
  billingInApp: integer("billing_in_app").notNull().default(1),
  billingEmail: integer("billing_email").notNull().default(1),
  accInApp: integer("acc_in_app").notNull().default(1),
  accEmail: integer("acc_email").notNull().default(1),
  // Task #108: opt-in/out for governance event emails (meeting scheduled,
  // agenda published, minutes adopted, public resolution adopted). In-app
  // notices still appear regardless of this setting.
  governanceEmail: integer("governance_email").notNull().default(1),
});

export const insertUserNotificationPreferencesSchema = createInsertSchema(userNotificationPreferencesTable);
export type InsertUserNotificationPreferences = z.infer<typeof insertUserNotificationPreferencesSchema>;
export type UserNotificationPreferences = typeof userNotificationPreferencesTable.$inferSelect;

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  role: text("role").notNull().default("manager"),
  name: text("name").notNull().default(""),
  unitId: text("unit_id").references(() => unitsTable.id),
  pending: boolean("pending").notNull().default(false),
  pendingEmail: text("pending_email"),
  phone: text("phone"),
  phoneNumber: text("phone_number"),
  phoneVerified: boolean("phone_verified").notNull().default(false),
  boardMember: boolean("board_member").notNull().default(false),
  officerTitle: text("officer_title"),
  termStart: text("term_start"),
  termEnd: text("term_end"),
  // Task #65: per-user opaque token for personal iCal feed URL.
  icalFeedToken: text("ical_feed_token"),
  // Task #30: invite-accept flow. The plaintext token is shown once to the
  // admin (and embedded in the invite URL); only its hash is stored. Cleared
  // on accept or admin-resend.
  inviteTokenHash: text("invite_token_hash"),
  inviteTokenExpiresAt: text("invite_token_expires_at"),
  createdAt: text("created_at").notNull(),
});

export const boardHistoryTable = pgTable("board_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  actorUserId: integer("actor_user_id"),
  actorName: text("actor_name").notNull().default(""),
  action: text("action").notNull(),
  oldBoardMember: boolean("old_board_member"),
  newBoardMember: boolean("new_board_member"),
  oldOfficerTitle: text("old_officer_title"),
  newOfficerTitle: text("new_officer_title"),
  oldTermStart: text("old_term_start"),
  newTermStart: text("new_term_start"),
  oldTermEnd: text("old_term_end"),
  newTermEnd: text("new_term_end"),
  createdAt: text("created_at").notNull(),
});

export type BoardHistory = typeof boardHistoryTable.$inferSelect;

export const emailChangeTokensTable = pgTable("email_change_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  newEmail: text("new_email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
  createdAt: text("created_at").notNull(),
});

export type EmailChangeToken = typeof emailChangeTokensTable.$inferSelect;

export const profileAuditTable = pgTable("profile_audit", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  unitId: text("unit_id"),
  action: text("action").notNull(),
  field: text("field").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  createdAt: text("created_at").notNull(),
});

export type ProfileAudit = typeof profileAuditTable.$inferSelect;

export const phoneVerificationsTable = pgTable("phone_verifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  phoneNumber: text("phone_number").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
  createdAt: text("created_at").notNull(),
});

export type PhoneVerification = typeof phoneVerificationsTable.$inferSelect;

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

export const boardMemberAuditTable = pgTable("board_member_audit", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  oldValue: boolean("old_value").notNull(),
  newValue: boolean("new_value").notNull(),
  changedByUserId: integer("changed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  changedByName: text("changed_by_name").notNull().default(""),
  changedByEmail: text("changed_by_email").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export type BoardMemberAudit = typeof boardMemberAuditTable.$inferSelect;

export const orgSettingsTable = pgTable("org_settings", {
  id: integer("id").primaryKey().default(1),
  driveRefreshToken: text("drive_refresh_token"),
  driveAccountEmail: text("drive_account_email"),
  driveConnectedAt: text("drive_connected_at"),
  driveEnabled: boolean("drive_enabled").notNull().default(false),
  driveRootFolderId: text("drive_root_folder_id"),
  driveLastSyncAt: text("drive_last_sync_at"),
  driveLastSyncCount: integer("drive_last_sync_count"),
  driveLastSyncFailures: integer("drive_last_sync_failures").notNull().default(0),
  driveMasterIndexFolderId: text("drive_master_index_folder_id"),
  driveSyncInProgress: boolean("drive_sync_in_progress").notNull().default(false),
  driveSyncProgressDone: integer("drive_sync_progress_done").notNull().default(0),
  driveSyncProgressTotal: integer("drive_sync_progress_total").notNull().default(0),
});

export const insertOrgSettingsSchema = createInsertSchema(orgSettingsTable);
export type InsertOrgSettings = z.infer<typeof insertOrgSettingsSchema>;
export type OrgSettings = typeof orgSettingsTable.$inferSelect;

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: text("type").notNull(),
  message: text("message").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  read: boolean("read").notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({ id: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;

export const notificationLogTable = pgTable("notification_log", {
  id: serial("id").primaryKey(),
  recipientGroup: text("recipient_group").notNull(),
  buildingId: integer("building_id"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  sentAt: text("sent_at").notNull(),
  sentBy: text("sent_by").notNull(),
  recipientCount: integer("recipient_count").notNull().default(0),
});

export const insertNotificationLogSchema = createInsertSchema(notificationLogTable).omit({ id: true });
export type InsertNotificationLog = z.infer<typeof insertNotificationLogSchema>;
export type NotificationLog = typeof notificationLogTable.$inferSelect;

export const announcementsTable = pgTable("announcements", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  buildingId: integer("building_id"),
  pinned: integer("pinned").notNull().default(0),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").notNull(),
  updatedAt: text("updated_at"),
  updatedBy: text("updated_by"),
});

export const insertAnnouncementSchema = createInsertSchema(announcementsTable).omit({ id: true });
export type InsertAnnouncement = z.infer<typeof insertAnnouncementSchema>;
export type Announcement = typeof announcementsTable.$inferSelect;

export const ownerAccountsTable = pgTable("owner_accounts", {
  id: serial("id").primaryKey(),
  unitId: text("unit_id").notNull().unique().references(() => unitsTable.id),
  openingBalance: integer("opening_balance").notNull().default(0),
  createdAt: text("created_at").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  // Task #139 — Membership roster and eligibility.
  // The "ownership_status" column is the source of truth for whether
  // an owner is in good standing for member-only actions (voting,
  // candidacy, quorum). Values: "active" | "suspended_voting" | "closed".
  // Derived nightly (or on demand) from the past-due threshold in
  // `organization_settings.past_due_voting_threshold_days`, with manual
  // override allowed by an admin and audit-logged via profile_audit.
  ownershipStatus: text("ownership_status").notNull().default("active"),
  ownershipStatusChangedAt: text("ownership_status_changed_at"),
  ownershipStatusReason: text("ownership_status_reason"),
});

export const insertOwnerAccountSchema = createInsertSchema(ownerAccountsTable).omit({ id: true });
export type InsertOwnerAccount = z.infer<typeof insertOwnerAccountSchema>;
export type OwnerAccount = typeof ownerAccountsTable.$inferSelect;

export const ledgerEntriesTable = pgTable("ledger_entries", {
  id: serial("id").primaryKey(),
  ownerAccountId: integer("owner_account_id").notNull().references(() => ownerAccountsTable.id),
  occurredOn: text("occurred_on").notNull(),
  postedAt: text("posted_at").notNull(),
  kind: text("kind").notNull(),
  chargeType: text("charge_type"),
  paymentMethod: text("payment_method"),
  amountCents: integer("amount_cents").notNull(),
  memo: text("memo"),
  postedBy: integer("posted_by").notNull(),
  voidedAt: text("voided_at"),
  voidedBy: integer("voided_by"),
  voidsEntryId: integer("voids_entry_id"),
  batchRef: text("batch_ref"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeChargeId: text("stripe_charge_id"),
  stripeStatus: text("stripe_status"),
  paymentSourceId: integer("payment_source_id"),
  sourceMotionId: integer("source_motion_id"),
  emergencyBypassId: integer("emergency_bypass_id"),
});

export const insertLedgerEntrySchema = createInsertSchema(ledgerEntriesTable).omit({ id: true });
export type InsertLedgerEntry = z.infer<typeof insertLedgerEntrySchema>;
export type LedgerEntry = typeof ledgerEntriesTable.$inferSelect;

export const bidRequestsTable = pgTable("bid_requests", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  scope: text("scope").notNull().default(""),
  buildingNum: integer("building_num").references(() => buildingsTable.num),
  unitId: text("unit_id").references(() => unitsTable.id),
  tradeCategory: text("trade_category").notNull(),
  status: text("status").notNull().default("draft"),
  deadline: text("deadline").notNull(),
  sealedBids: boolean("sealed_bids").notNull().default(false),
  sealedOpenedAt: text("sealed_opened_at"),
  notifyNonAwarded: boolean("notify_non_awarded").notNull().default(true),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: text("created_at").notNull(),
  awardedVendorId: integer("awarded_vendor_id").references(() => vendorsTable.id),
  awardedAt: text("awarded_at"),
  awardRationale: text("award_rationale"),
  awardMemoStorageKey: text("award_memo_storage_key"),
  awardedWorkOrderId: text("awarded_work_order_id").references(() => workOrdersTable.id),
  sourceWorkOrderId: text("source_work_order_id").references(() => workOrdersTable.id),
  awardMotionId: integer("award_motion_id"),
  awardEmergencyBypassId: integer("award_emergency_bypass_id"),
  resolutionId: integer("resolution_id"),
});

export type BidRequest = typeof bidRequestsTable.$inferSelect;

export const bidScopeItemsTable = pgTable("bid_scope_items", {
  id: serial("id").primaryKey(),
  bidRequestId: integer("bid_request_id").notNull().references(() => bidRequestsTable.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  label: text("label").notNull(),
  notes: text("notes"),
});

export type BidScopeItem = typeof bidScopeItemsTable.$inferSelect;

export const bidInvitationsTable = pgTable("bid_invitations", {
  id: serial("id").primaryKey(),
  bidRequestId: integer("bid_request_id").notNull().references(() => bidRequestsTable.id, { onDelete: "cascade" }),
  vendorId: integer("vendor_id").notNull().references(() => vendorsTable.id),
  tokenHash: text("token_hash").notNull().unique(),
  tokenExpiresAt: text("token_expires_at").notNull(),
  status: text("status").notNull().default("invited"),
  invitedAt: text("invited_at").notNull(),
  viewedAt: text("viewed_at"),
  submittedAt: text("submitted_at"),
  declinedAt: text("declined_at"),
  reminderSentAt: text("reminder_sent_at"),
}, (t) => [unique().on(t.bidRequestId, t.vendorId)]);

export type BidInvitation = typeof bidInvitationsTable.$inferSelect;

export const bidQuotesTable = pgTable("bid_quotes", {
  id: serial("id").primaryKey(),
  bidRequestId: integer("bid_request_id").notNull().references(() => bidRequestsTable.id, { onDelete: "cascade" }),
  vendorId: integer("vendor_id").notNull().references(() => vendorsTable.id),
  invitationId: integer("invitation_id").references(() => bidInvitationsTable.id, { onDelete: "set null" }),
  leadTimeDays: integer("lead_time_days"),
  paymentTerms: text("payment_terms"),
  warrantyText: text("warranty_text"),
  notes: text("notes"),
  licenseStorageKey: text("license_storage_key"),
  coiStorageKey: text("coi_storage_key"),
  quotePdfStorageKey: text("quote_pdf_storage_key"),
  enteredByManager: boolean("entered_by_manager").notNull().default(false),
  firmConfirmation: boolean("firm_confirmation").notNull().default(false),
  totalCents: integer("total_cents").notNull().default(0),
  submittedAt: text("submitted_at").notNull(),
}, (t) => [unique().on(t.bidRequestId, t.vendorId)]);

export type BidQuote = typeof bidQuotesTable.$inferSelect;

export const bidQuoteLinesTable = pgTable("bid_quote_lines", {
  id: serial("id").primaryKey(),
  bidQuoteId: integer("bid_quote_id").notNull().references(() => bidQuotesTable.id, { onDelete: "cascade" }),
  scopeItemId: integer("scope_item_id").notNull().references(() => bidScopeItemsTable.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull().default(0),
}, (t) => [unique().on(t.bidQuoteId, t.scopeItemId)]);

export type BidQuoteLine = typeof bidQuoteLinesTable.$inferSelect;

export const bidAttachmentsTable = pgTable("bid_attachments", {
  id: serial("id").primaryKey(),
  bidRequestId: integer("bid_request_id").notNull().references(() => bidRequestsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  size: integer("size").notNull().default(0),
  contentType: text("content_type"),
  storageKey: text("storage_key").notNull(),
  kind: text("kind").notNull().default("spec"),
  uploadedByUserId: integer("uploaded_by_user_id"),
  uploadedByName: text("uploaded_by_name").notNull().default(""),
  uploadedAt: text("uploaded_at").notNull(),
});

export type BidAttachment = typeof bidAttachmentsTable.$inferSelect;

export const ownerPaymentMethodsTable = pgTable("owner_payment_methods", {
  id: serial("id").primaryKey(),
  ownerAccountId: integer("owner_account_id").notNull().references(() => ownerAccountsTable.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  stripePaymentMethodId: text("stripe_payment_method_id").notNull().unique(),
  brand: text("brand"),
  last4: text("last4"),
  kind: text("kind").notNull(),
  isAutoPay: boolean("is_auto_pay").notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export type OwnerPaymentMethod = typeof ownerPaymentMethodsTable.$inferSelect;

export const paymentAttemptsTable = pgTable("payment_attempts", {
  id: serial("id").primaryKey(),
  ledgerEntryId: integer("ledger_entry_id"),
  paidLedgerEntryId: integer("paid_ledger_entry_id"),
  ownerAccountId: integer("owner_account_id").notNull().references(() => ownerAccountsTable.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  surchargeCents: integer("surcharge_cents").notNull().default(0),
  refundedAmountCents: integer("refunded_amount_cents").notNull().default(0),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeChargeId: text("stripe_charge_id"),
  paymentMethodId: integer("payment_method_id"),
  initiatedBy: text("initiated_by").notNull().default("owner"),
  errorMessage: text("error_message"),
  disputeStatus: text("dispute_status"),
  saveMethodRequested: boolean("save_method_requested").notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type PaymentAttempt = typeof paymentAttemptsTable.$inferSelect;

export const stripeEventsProcessedTable = pgTable("stripe_events_processed", {
  stripeEventId: text("stripe_event_id").primaryKey(),
  type: text("type").notNull(),
  processedAt: text("processed_at").notNull(),
});

export type StripeEventProcessed = typeof stripeEventsProcessedTable.$inferSelect;

// Singleton (id=1) holding the active Stripe configuration. Falls back to env
// when no row exists.
export const stripeConfigTable = pgTable("stripe_config", {
  id: integer("id").primaryKey().default(1),
  secretKey: text("secret_key"),
  publishableKey: text("publishable_key"),
  webhookSecret: text("webhook_secret"),
  updatedAt: text("updated_at"),
  updatedByUserId: integer("updated_by_user_id"),
  updatedByName: text("updated_by_name"),
});

export type StripeConfig = typeof stripeConfigTable.$inferSelect;

// ── Task #62: Board Motions & Voting Engine ─────────────────────────────────
// A generic, reusable motion. Specific applications (Stripe key change,
// future: budget approval, vendor authorization, board resolutions) embed
// their typed payload in `payload` and identify themselves via `kind`.
//
// Voting rule shape:
//   { type: "unanimous" }
//   { type: "majority" }
//   { type: "supermajority", threshold: 0.667 }
//   { type: "single_approver" }
//   { type: "quorum_only", quorum: 3 }
export type MotionVotingRule =
  | { type: "unanimous" }
  | { type: "majority" }
  | { type: "supermajority"; threshold: number }
  | { type: "single_approver" }
  | { type: "quorum_only"; quorum: number };

export const motionsTable = pgTable("motions", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(), // e.g. "stripe_config", "general"
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  bodyHash: text("body_hash"), // sha256 hex; frozen when first vote is cast
  votingRule: jsonb("voting_rule").$type<MotionVotingRule>().notNull(),
  // Task #142: who is eligible to vote on this motion.
  //   - "board"   → board members only (default; preserves legacy behavior)
  //   - "members" → every owner in good standing (member-class motions:
  //                 dues changes, rule ratifications, etc.)
  audience: text("audience").notNull().default("board"),
  status: text("status").notNull().default("draft"),
  // status: draft | open | adopted | rejected | withdrawn | expired
  outcome: text("outcome"), // mirrors final status for adopted|rejected|expired|withdrawn
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: text("created_at").notNull(),
  openedAt: text("opened_at"),
  closesAt: text("closes_at"),
  resolvedAt: text("resolved_at"),
  reminderSentAt: text("reminder_sent_at"),
  meetingId: integer("meeting_id"), // future: link to a board meeting record
  payload: jsonb("payload"), // typed bag for kind-specific data
});

export type Motion = typeof motionsTable.$inferSelect;

export const motionVotesTable = pgTable("motion_votes", {
  id: serial("id").primaryKey(),
  motionId: integer("motion_id").notNull().references(() => motionsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  userName: text("user_name").notNull().default(""),
  decision: text("decision").notNull(), // approve | reject | abstain
  comment: text("comment"),
  bodyHashAtVote: text("body_hash_at_vote"),
  createdAt: text("created_at").notNull(),
}, (t) => [unique().on(t.motionId, t.userId)]);

export type MotionVote = typeof motionVotesTable.$inferSelect;

// Task #64: Emergency bypasses.
// Admins may temporarily bypass a motion gate; a ratification motion is
// auto-created. If the ratification is rejected, the bypass is flagged for
// reversal.
export const emergencyBypassesTable = pgTable("emergency_bypasses", {
  id: serial("id").primaryKey(),
  targetType: text("target_type").notNull(), // work_order | bid_award | special_assessment | policy
  targetId: text("target_id").notNull(),
  action: text("action").notNull(), // describes the action that was bypassed
  reason: text("reason").notNull(),
  byUserId: integer("by_user_id").references(() => usersTable.id),
  byUserName: text("by_user_name").notNull().default(""),
  ratificationMotionId: integer("ratification_motion_id").references(() => motionsTable.id),
  ratificationStatus: text("ratification_status").notNull().default("pending"),
  // pending | ratified | rejected | withdrawn — set by motions.applyAdopted / withdraw
  reversalRequired: boolean("reversal_required").notNull().default(false),
  consumedAt: text("consumed_at"),
  payload: jsonb("payload"),
  createdAt: text("created_at").notNull(),
});

export type EmergencyBypass = typeof emergencyBypassesTable.$inferSelect;

export const motionAttachmentsTable = pgTable("motion_attachments", {
  id: serial("id").primaryKey(),
  motionId: integer("motion_id").notNull().references(() => motionsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  size: integer("size").notNull().default(0),
  contentType: text("content_type"),
  storageKey: text("storage_key").notNull(),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => usersTable.id),
  uploadedByName: text("uploaded_by_name").notNull().default(""),
  uploadedAt: text("uploaded_at").notNull(),
});

export type MotionAttachment = typeof motionAttachmentsTable.$inferSelect;

// ── Task #63: Board Resolutions Library ─────────────────────────────────────
// A resolution wraps a motion of kind `resolution`. The motion handles the
// vote; the resolution adds an HOA-standard number assigned at adoption,
// supersede/rescind chains, and a stored PDF snapshot.
export const resolutionsTable = pgTable("resolutions", {
  id: serial("id").primaryKey(),
  motionId: integer("motion_id").notNull().unique().references(() => motionsTable.id, { onDelete: "cascade" }),
  category: text("category").notNull().default("other"),
  // architectural | financial | rules | personnel | emergency | other
  number: text("number"), // assigned at adoption, e.g. "2026-007"
  numberYear: integer("number_year"),
  numberSeq: integer("number_seq"),
  // Set on the OLDER resolution when a newer one supersedes it.
  supersededByResolutionId: integer("superseded_by_resolution_id"),
  // Motion (kind=rescind_resolution) that, once adopted, rescinds this one.
  rescindedByMotionId: integer("rescinded_by_motion_id").references(() => motionsTable.id, { onDelete: "set null" }),
  pdfStorageKey: text("pdf_storage_key"),
  createdAt: text("created_at").notNull(),
  adoptedAt: text("adopted_at"),
  // Task #66: governance transparency — owners only see public adopted resolutions.
  public: boolean("public").notNull().default(false),
});

export type Resolution = typeof resolutionsTable.$inferSelect;

// ── Task #74: Calendar foundation ───────────────────────────────────────────

export type CalendarRecurrence = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval?: number;
  byday?: string[]; // ["MO","WE","FR"] (weekly only)
  until?: string; // ISO date inclusive
  count?: number;
} | null;

export const calendarSubCalendarsTable = pgTable("calendar_sub_calendars", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#3245FF"),
  description: text("description").notNull().default(""),
  editorRoles: jsonb("editor_roles").$type<string[]>().notNull(),
  // viewerRoles: empty array = all authenticated; otherwise restrict
  viewerRoles: jsonb("viewer_roles").$type<string[]>().notNull().default([]),
  isPublic: boolean("is_public").notNull().default(false),
  isExternal: boolean("is_external").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
});

export type CalendarSubCalendar = typeof calendarSubCalendarsTable.$inferSelect;

export const calendarEventsTable = pgTable("calendar_events", {
  id: serial("id").primaryKey(),
  subCalendarId: integer("sub_calendar_id")
    .notNull()
    .references(() => calendarSubCalendarsTable.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  // ISO 8601 with TZ. For all-day events, dates are stored as YYYY-MM-DD.
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  allDay: boolean("all_day").notNull().default(false),
  locationText: text("location_text"),
  locationUrl: text("location_url"),
  // Task #94: Amenity bookings — when set, this event reserves the named
  // resource and conflict detection prevents overlapping bookings.
  resourceId: integer("resource_id").references((): any => calendarResourcesTable.id, { onDelete: "set null" }),
  // Task #94: Optional capacity for community RSVP events / bookings.
  capacity: integer("capacity"),
  // Task #78: Optional per-household cap for community RSVPs (e.g. max 4
  // attendees per unit). Null = no per-unit cap.
  perUnitCap: integer("per_unit_cap"),
  recurrence: jsonb("recurrence").$type<CalendarRecurrence>(),
  exceptions: jsonb("exceptions").$type<string[]>().notNull().default([]),
  // For recurring overrides: each entry { originalDate: ISO, startsAt, endsAt, title?, body? }
  overrides: jsonb("overrides").$type<Array<{
    originalDate: string;
    startsAt?: string;
    endsAt?: string;
    title?: string;
    body?: string;
    cancelled?: boolean;
  }>>().notNull().default([]),
  source: text("source"), // e.g. "external:42", "work_order:WO-123"
  sourceRefType: text("source_ref_type"),
  sourceRefId: text("source_ref_id"),
  externalUid: text("external_uid"),
  // Task #76: when set, restricts visibility to this owner's private timeline
  // (in addition to the sub-calendar's role-based visibility).
  ownerUserId: integer("owner_user_id"),
  cancelled: boolean("cancelled").notNull().default(false),
  createdByUserId: integer("created_by_user_id"),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type CalendarEvent = typeof calendarEventsTable.$inferSelect;

export const calendarEventAttachmentsTable = pgTable("calendar_event_attachments", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id")
    .notNull()
    .references(() => calendarEventsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  size: integer("size").notNull().default(0),
  contentType: text("content_type"),
  storageKey: text("storage_key").notNull(),
  uploadedByUserId: integer("uploaded_by_user_id"),
  uploadedByName: text("uploaded_by_name").notNull().default(""),
  uploadedAt: text("uploaded_at").notNull(),
});

export type CalendarEventAttachment = typeof calendarEventAttachmentsTable.$inferSelect;

export const calendarEventRemindersTable = pgTable("calendar_event_reminders", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id")
    .notNull()
    .references(() => calendarEventsTable.id, { onDelete: "cascade" }),
  // For recurring events, this points at a specific instance start.
  instanceStartsAt: text("instance_starts_at").notNull(),
  // Lead time in minutes before event start (15, 60, 1440, 4320, 10080, 43200)
  leadMinutes: integer("lead_minutes").notNull(),
  channelInApp: boolean("channel_in_app").notNull().default(true),
  channelEmail: boolean("channel_email").notNull().default(true),
  channelSms: boolean("channel_sms").notNull().default(false),
  // Either a specific user, or null = all users with this sub-calendar visible.
  userId: integer("user_id"),
  // ISO timestamp; null until dispatched
  dispatchedAt: text("dispatched_at"),
  createdAt: text("created_at").notNull(),
});

export type CalendarEventReminder = typeof calendarEventRemindersTable.$inferSelect;

export const calendarEventAuditTable = pgTable("calendar_event_audit", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  action: text("action").notNull(), // created | updated | cancelled | deleted
  actorUserId: integer("actor_user_id"),
  actorName: text("actor_name").notNull().default(""),
  diff: jsonb("diff"),
  createdAt: text("created_at").notNull(),
});

export type CalendarEventAudit = typeof calendarEventAuditTable.$inferSelect;

export const calendarUserPrefsTable = pgTable("calendar_user_prefs", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  // Map of subCalendarSlug -> boolean (visible)
  visibleSubCalendars: jsonb("visible_sub_calendars").$type<Record<string, boolean>>().notNull().default({}),
  defaultView: text("default_view").notNull().default("month"),
  icalToken: text("ical_token").unique(),
  icalTokenCreatedAt: text("ical_token_created_at"),
  updatedAt: text("updated_at").notNull(),
});

export type CalendarUserPrefs = typeof calendarUserPrefsTable.$inferSelect;

export const calendarExternalFeedsTable = pgTable("calendar_external_feeds", {
  id: serial("id").primaryKey(),
  subCalendarId: integer("sub_calendar_id")
    .notNull()
    .references(() => calendarSubCalendarsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastFetchedAt: text("last_fetched_at"),
  lastError: text("last_error"),
  lastEventCount: integer("last_event_count").notNull().default(0),
  createdByUserId: integer("created_by_user_id"),
  createdAt: text("created_at").notNull(),
});

export type CalendarExternalFeed = typeof calendarExternalFeedsTable.$inferSelect;

// ── Task #65: Board Meetings, Agendas & Minutes ────────────────────────────
// A meeting groups an agenda, attendance, in-meeting motions, and minutes.
// `kind` controls notice requirements (open / executive / annual).
// `status` flows scheduled → in_progress → adjourned.
// Minutes are draft until proposed; final adoption is recorded by linking
// `minutesAdoptionMotionId` to the motion adopted at the next meeting.
export const meetingsTable = pgTable("meetings", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull().default("open"), // open | executive | annual
  title: text("title").notNull(),
  scheduledAt: text("scheduled_at").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  locationPhysical: text("location_physical"),
  locationVideoLink: text("location_video_link"),
  noticeText: text("notice_text").notNull().default(""),
  noticePostedAt: text("notice_posted_at"),
  status: text("status").notNull().default("scheduled"), // scheduled | in_progress | adjourned | cancelled
  startedAt: text("started_at"),
  adjournedAt: text("adjourned_at"),
  agendaPacketStorageKey: text("agenda_packet_storage_key"),
  agendaPacketGeneratedAt: text("agenda_packet_generated_at"),
  minutesContent: text("minutes_content").notNull().default(""),
  minutesStatus: text("minutes_status").notNull().default("none"), // none | draft | proposed | adopted
  minutesAdoptionMotionId: integer("minutes_adoption_motion_id"),
  minutesAdoptedAt: text("minutes_adopted_at"),
  minutesStorageKey: text("minutes_storage_key"),
  quorumMode: text("quorum_mode"), // overrides org default when set
  quorumPercentBp: integer("quorum_percent_bp"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export type Meeting = typeof meetingsTable.$inferSelect;

export const meetingAgendaItemsTable = pgTable("meeting_agenda_items", {
  id: serial("id").primaryKey(),
  meetingId: integer("meeting_id").notNull().references(() => meetingsTable.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  kind: text("kind").notNull().default("discussion"), // discussion | motion | report | break
  title: text("title").notNull(),
  notes: text("notes"),
  motionId: integer("motion_id").references(() => motionsTable.id, { onDelete: "set null" }),
  presenter: text("presenter"),
  itemMinutes: text("item_minutes").notNull().default(""),
  // Task #66: items in closed/executive session are hidden from owners.
  closedSession: boolean("closed_session").notNull().default(false),
});

export type MeetingAgendaItem = typeof meetingAgendaItemsTable.$inferSelect;

// ── Task #66: Owner-facing governance transparency ──────────────────────────
// Owners may post comments on agenda items (only on items that are NOT
// closed_session and only after the meeting notice is posted). Comments
// support edit (editedAt) and soft-delete (deletedAt).
export const meetingAgendaCommentsTable = pgTable("meeting_agenda_comments", {
  id: serial("id").primaryKey(),
  agendaItemId: integer("agenda_item_id")
    .notNull()
    .references(() => meetingAgendaItemsTable.id, { onDelete: "cascade" }),
  meetingId: integer("meeting_id")
    .notNull()
    .references(() => meetingsTable.id, { onDelete: "cascade" }),
  ownerUserId: integer("owner_user_id").notNull().references(() => usersTable.id),
  ownerName: text("owner_name").notNull().default(""),
  unitId: text("unit_id").references(() => unitsTable.id),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull(),
  editedAt: text("edited_at"),
  deletedAt: text("deleted_at"),
});

export type MeetingAgendaComment = typeof meetingAgendaCommentsTable.$inferSelect;

// Auto-published notices (meeting notices, agenda packets, adopted minutes,
// adopted resolutions). One row per published notice for owner visibility.
export const noticesTable = pgTable("notices", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  // meeting_scheduled | agenda_published | minutes_adopted | resolution_adopted
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  sourceType: text("source_type").notNull(), // meeting | resolution
  sourceId: integer("source_id").notNull(),
  meetingId: integer("meeting_id"),
  postedAt: text("posted_at").notNull(),
  requiredWindowDays: integer("required_window_days"),
}, (t) => [unique().on(t.kind, t.sourceType, t.sourceId)]);

export type Notice = typeof noticesTable.$inferSelect;

export const meetingAttendanceTable = pgTable("meeting_attendance", {
  id: serial("id").primaryKey(),
  meetingId: integer("meeting_id").notNull().references(() => meetingsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  userName: text("user_name").notNull().default(""),
  // present | remote | absent | excused
  status: text("status").notNull().default("absent"),
  isBoardMember: boolean("is_board_member").notNull().default(false),
  recordedAt: text("recorded_at").notNull(),
}, (t) => [unique().on(t.meetingId, t.userId)]);

export type MeetingAttendance = typeof meetingAttendanceTable.$inferSelect;

// ── Task #76: Calendar — financial & compliance integrations ────────────────

// Recurring assessment schedules (regular dues). Materialized as recurring
// calendar events on the financial sub-calendar; per-owner private events on
// the owner timeline are emitted by billing when ledger charges are posted.
export const assessmentSchedulesTable = pgTable("assessment_schedules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // monthly | quarterly | semiannual | annual
  frequency: text("frequency").notNull(),
  amountCents: integer("amount_cents").notNull(),
  // Day of month (1–28) the charge is due. For non-monthly frequencies the
  // first occurrence is anchored at startDate and stepped by frequency.
  dueDay: integer("due_day").notNull().default(1),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  active: boolean("active").notNull().default(true),
  // Reminder lead times (minutes) materialized for each instance.
  reminderLeadsMinutes: jsonb("reminder_leads_minutes").$type<number[]>().notNull().default([10080, 1440]),
  notes: text("notes").notNull().default(""),
  calendarEventId: integer("calendar_event_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type AssessmentSchedule = typeof assessmentSchedulesTable.$inferSelect;

// One-time special assessments with a fixed milestone schedule.
export const specialAssessmentsTable = pgTable("special_assessments", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  amountCents: integer("amount_cents").notNull(),
  // Lifecycle: draft | notice_mailed | hearing_scheduled | adopted | billed | closed
  status: text("status").notNull().default("draft"),
  // Milestone dates (YYYY-MM-DD or ISO).
  noticeDate: text("notice_date"),
  hearingDate: text("hearing_date"),
  hearingLocation: text("hearing_location"),
  adoptionDate: text("adoption_date"),
  billingDate: text("billing_date"),
  dueDate: text("due_date"),
  motionId: integer("motion_id"),
  notes: text("notes").notNull().default(""),
  createdByUserId: integer("created_by_user_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type SpecialAssessment = typeof specialAssessmentsTable.$inferSelect;

// Org-wide collections policy (singleton id=1). Defines days-after-due for
// each escalation step. Materialized per-owner when an owner is delinquent.
export const collectionsPoliciesTable = pgTable("collections_policies", {
  id: integer("id").primaryKey().default(1),
  reminderDays: integer("reminder_days").notNull().default(10),
  lateNoticeDays: integer("late_notice_days").notNull().default(30),
  demandLetterDays: integer("demand_letter_days").notNull().default(60),
  lienDays: integer("lien_days").notNull().default(90),
  attorneyDays: integer("attorney_days").notNull().default(120),
  active: boolean("active").notNull().default(true),
  updatedAt: text("updated_at"),
});

export type CollectionsPolicy = typeof collectionsPoliciesTable.$inferSelect;

// Annual budget cycle milestones (per fiscal year).
export const budgetCyclesTable = pgTable("budget_cycles", {
  id: serial("id").primaryKey(),
  fiscalYear: integer("fiscal_year").notNull().unique(),
  draftDueDate: text("draft_due_date"),
  reviewMeetingDate: text("review_meeting_date"),
  ratificationMeetingDate: text("ratification_meeting_date"),
  publicationDate: text("publication_date"),
  reserveStudyRefreshDate: text("reserve_study_refresh_date"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type BudgetCycle = typeof budgetCyclesTable.$inferSelect;

// Per-category annual budget targets. Lets the board set how much they
// plan to spend in each work-order category for a given fiscal year so
// the Reports page can compare actual spend to budget and flag overspend.
export const budgetsTable = pgTable("budgets", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  fiscalYear: integer("fiscal_year").notNull(),
  amount: integer("amount").notNull().default(0),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [unique().on(t.category, t.fiscalYear)]);

export const insertBudgetSchema = createInsertSchema(budgetsTable).omit({ id: true });
export type InsertBudget = z.infer<typeof insertBudgetSchema>;
export type Budget = typeof budgetsTable.$inferSelect;

// Reserve study lifecycle items (capital projects).
export const reserveProjectsTable = pgTable("reserve_projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull().default("other"), // roof | paint | structural | hvac | landscape | other
  estimatedCostCents: integer("estimated_cost_cents").notNull().default(0),
  fundingDate: text("funding_date"),
  bidWindowStart: text("bid_window_start"),
  bidWindowEnd: text("bid_window_end"),
  scheduledStart: text("scheduled_start"),
  scheduledEnd: text("scheduled_end"),
  status: text("status").notNull().default("planned"), // planned | bidding | scheduled | in_progress | complete | deferred
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type ReserveProject = typeof reserveProjectsTable.$inferSelect;

// Generic compliance / regulatory deadlines: tax filings, audit windows,
// insurance renewal pre-cycles, regulator reports, etc.
export const complianceItemsTable = pgTable("compliance_items", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(), // tax | audit | insurance | regulatory | bank_recon | other
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  dueDate: text("due_date").notNull(),
  // Optional recurrence: { freq, interval? } — e.g. yearly tax; null = one-off.
  recurrence: jsonb("recurrence").$type<{ freq: "MONTHLY" | "YEARLY" | "QUARTERLY"; interval?: number } | null>(),
  status: text("status").notNull().default("open"), // open | in_progress | done | overdue
  ownerUserId: integer("owner_user_id"), // responsible person
  reminderLeadsMinutes: jsonb("reminder_leads_minutes").$type<number[]>().notNull().default([43200, 10080, 1440]),
  notes: text("notes").notNull().default(""),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type ComplianceItem = typeof complianceItemsTable.$inferSelect;

// Violations with stage-based cure deadlines and hearing escalation.
export const violationsTable = pgTable("violations", {
  id: serial("id").primaryKey(),
  unitId: text("unit_id").notNull().references(() => unitsTable.id),
  ownerUserId: integer("owner_user_id"),
  ownerName: text("owner_name").notNull().default(""),
  category: text("category").notNull(), // landscaping | parking | trash | architectural | nuisance | other
  description: text("description").notNull(),
  // Lifecycle: open | first_notice | second_notice | hearing | fined | resolved | dismissed
  status: text("status").notNull().default("open"),
  observedAt: text("observed_at").notNull(),
  firstNoticeDate: text("first_notice_date"),
  cureDeadline: text("cure_deadline"),
  secondNoticeDate: text("second_notice_date"),
  hearingDate: text("hearing_date"),
  resolvedAt: text("resolved_at"),
  fineCents: integer("fine_cents").notNull().default(0),
  createdByUserId: integer("created_by_user_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type Violation = typeof violationsTable.$inferSelect;

// Board hearings (violation hearings, special-assessment hearings, ACC appeals).
export const hearingsTable = pgTable("hearings", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(), // violation | special_assessment | acc_appeal | other
  refType: text("ref_type"), // matches kind: violations | special_assessments | architectural_requests
  refId: integer("ref_id"),
  title: text("title").notNull(),
  scheduledAt: text("scheduled_at").notNull(),
  locationText: text("location_text"),
  locationUrl: text("location_url"),
  noticeDate: text("notice_date"),
  status: text("status").notNull().default("scheduled"), // scheduled | held | continued | cancelled
  outcome: text("outcome"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type Hearing = typeof hearingsTable.$inferSelect;

// Task #94: Bookable amenity resources (clubhouse, pool deck, grill, …).
export const calendarResourcesTable = pgTable("calendar_resources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  capacity: integer("capacity"),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const insertCalendarResourceSchema = createInsertSchema(calendarResourcesTable).omit({ id: true });
export type InsertCalendarResource = z.infer<typeof insertCalendarResourceSchema>;
export type CalendarResource = typeof calendarResourcesTable.$inferSelect;

// Task #94: Resident RSVPs to a specific occurrence of an event.
// occurrenceKey "" means the base (single) event; recurring instances get
// a YYYY-MM-DD or ISO key matching the expanded occurrence.
export const calendarEventRsvpsTable = pgTable("calendar_event_rsvps", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id")
    .notNull()
    .references(() => calendarEventsTable.id, { onDelete: "cascade" }),
  occurrenceKey: text("occurrence_key").notNull().default(""),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  userName: text("user_name").notNull().default(""),
  status: text("status").notNull(), // yes | no | maybe (Task #78: yes may be waitlisted)
  // Task #78: party size (number of household attendees including the RSVP
  // user). Defaults to 1. Capacity & per-unit cap are computed against the
  // sum of partySize across all "yes" RSVPs (excluding waitlisted).
  partySize: integer("party_size").notNull().default(1),
  // Task #78: when status='yes' but capacity was full at RSVP time, this is
  // the waitlist position (1-based). Null = confirmed attending. On cancel
  // by another attendee the next waitlisted entry is promoted.
  waitlistPosition: integer("waitlist_position"),
  // Task #78: owner's unit (denormalized) for per-unit cap enforcement.
  unitId: text("unit_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [unique().on(t.eventId, t.occurrenceKey, t.userId)]);

export type CalendarEventRsvp = typeof calendarEventRsvpsTable.$inferSelect;

// ── Task #77: Amenity reservations ───────────────────────────────────────

export type AmenityBookingUnit = "whole_day" | "hourly" | "block" | "overnight";

export interface AmenityRules {
  // Allowed-hours window per weekday: 0=Sun..6=Sat. null = closed.
  hoursByWeekday?: Array<{ open: string; close: string } | null>; // "08:00"
  blockHours?: number; // for "block" unit, e.g. 4 for 4-hour blocks
  minLeadMinutes?: number; // advance-notice minimum
  maxLeadDays?: number; // can't book more than N days in the future
  monthlyCapPerOwner?: number; // max bookings/owner/month, 0 = unlimited
  cancelWindowHours?: number; // owner can self-cancel up to N hours before
  guestParkingNightlyCap?: number; // max nights per rolling 30d (guest_parking only)
  requiresLifeguard?: boolean; // pool_party
}

export const amenitiesTable = pgTable("amenities", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  photoUrl: text("photo_url"),
  capacity: integer("capacity").notNull().default(0), // 0 = no cap
  bookingUnit: text("booking_unit").$type<AmenityBookingUnit>().notNull().default("hourly"),
  depositCents: integer("deposit_cents").notNull().default(0),
  rules: jsonb("rules").$type<AmenityRules>().notNull().default({}),
  agreementText: text("agreement_text").notNull().default(""),
  agreementTemplatePath: text("agreement_template_path"),
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type Amenity = typeof amenitiesTable.$inferSelect;

export const amenityBlackoutsTable = pgTable("amenity_blackouts", {
  id: serial("id").primaryKey(),
  amenityId: integer("amenity_id")
    .notNull()
    .references(() => amenitiesTable.id, { onDelete: "cascade" }),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  reason: text("reason").notNull().default(""),
  createdByUserId: integer("created_by_user_id"),
  createdAt: text("created_at").notNull(),
});

export type AmenityBlackout = typeof amenityBlackoutsTable.$inferSelect;

export const amenityLifeguardWindowsTable = pgTable("amenity_lifeguard_windows", {
  id: serial("id").primaryKey(),
  amenityId: integer("amenity_id")
    .notNull()
    .references(() => amenitiesTable.id, { onDelete: "cascade" }),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  staffName: text("staff_name").notNull().default(""),
  createdByUserId: integer("created_by_user_id"),
  createdAt: text("created_at").notNull(),
});

export type AmenityLifeguardWindow = typeof amenityLifeguardWindowsTable.$inferSelect;

export type AmenityBookingStatus =
  | "pending_payment"
  | "confirmed"
  | "used_pending_inspection"
  | "used"
  | "cancelled"
  | "forfeited"
  | "refunded";

export const amenityBookingsTable = pgTable("amenity_bookings", {
  id: serial("id").primaryKey(),
  amenityId: integer("amenity_id")
    .notNull()
    .references(() => amenitiesTable.id, { onDelete: "restrict" }),
  ownerUserId: integer("owner_user_id").notNull(),
  unitId: text("unit_id"),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  guestCount: integer("guest_count").notNull().default(0),
  purpose: text("purpose").notNull().default(""),
  status: text("status").$type<AmenityBookingStatus>().notNull().default("pending_payment"),
  depositCents: integer("deposit_cents").notNull().default(0),
  depositPaidAt: text("deposit_paid_at"),
  depositRefundedAt: text("deposit_refunded_at"),
  agreementSigned: boolean("agreement_signed").notNull().default(false),
  agreementSignedAt: text("agreement_signed_at"),
  agreementSignedIp: text("agreement_signed_ip"),
  agreementSignedName: text("agreement_signed_name").notNull().default(""),
  agreementText: text("agreement_text").notNull().default(""),
  lifeguardRequested: boolean("lifeguard_requested").notNull().default(false),
  permitNumber: text("permit_number"),
  calendarEventId: integer("calendar_event_id"),
  managerNotes: text("manager_notes").notNull().default(""),
  cancelledAt: text("cancelled_at"),
  cancelledByUserId: integer("cancelled_by_user_id"),
  cancellationReason: text("cancellation_reason").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type AmenityBooking = typeof amenityBookingsTable.$inferSelect;

export const amenityBookingAuditTable = pgTable("amenity_booking_audit", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull(),
  action: text("action").notNull(),
  actorUserId: integer("actor_user_id"),
  actorName: text("actor_name").notNull().default(""),
  diff: jsonb("diff"),
  createdAt: text("created_at").notNull(),
});

export type AmenityBookingAudit = typeof amenityBookingAuditTable.$inferSelect;

// ── Task #75: Calendar — Governance & Operations Integrations ──────────────
// Note: Task #76 (above) already defines complianceItemsTable with a richer
// schema (status, ownerUserId, reminderLeadsMinutes). Task #75's version
// (dueOn / reminderDays / responsibleParty / active) is dropped here in
// favor of HEAD's; the task #75 compliance-items route is removed and
// wiring materialization into the HEAD compliance routes is a follow-up.

export const committeesTable = pgTable("committees", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  // Maps to a calendar_sub_calendars row (committees-<slug>) created on demand.
  subCalendarId: integer("sub_calendar_id").references(() => calendarSubCalendarsTable.id, { onDelete: "set null" }),
  active: boolean("active").notNull().default(true),
  createdAt: text("created_at").notNull(),
});
export type Committee = typeof committeesTable.$inferSelect;

export const committeeMembersTable = pgTable("committee_members", {
  id: serial("id").primaryKey(),
  committeeId: integer("committee_id").notNull().references(() => committeesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"), // chair | member
  createdAt: text("created_at").notNull(),
}, (t) => [unique().on(t.committeeId, t.userId)]);
export type CommitteeMember = typeof committeeMembersTable.$inferSelect;

export const electionCyclesTable = pgTable("election_cycles", {
  id: serial("id").primaryKey(),
  year: integer("year").notNull(),
  label: text("label").notNull(),
  nominationsOpenOn: text("nominations_open_on"),
  nominationsCloseOn: text("nominations_close_on"),
  ballotMailingOn: text("ballot_mailing_on"),
  electionDayOn: text("election_day_on"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
});
export type ElectionCycle = typeof electionCyclesTable.$inferSelect;

export const vendorContractsTable = pgTable("vendor_contracts", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id").notNull().references(() => vendorsTable.id, { onDelete: "cascade" }),
  serviceType: text("service_type").notNull(), // landscaping | pool | pest | trash | gate | fire | other
  title: text("title").notNull(),
  // Recurrence stored same as calendar_events (CalendarRecurrence)
  recurrence: jsonb("recurrence").$type<CalendarRecurrence>(),
  firstServiceOn: text("first_service_on").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  active: boolean("active").notNull().default(true),
  contractDocStorageKey: text("contract_doc_storage_key"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
});
export type VendorContract = typeof vendorContractsTable.$inferSelect;

export const inspectionsTable = pgTable("inspections", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(), // annual_walkthrough | acc_sweep | insurance | reserve_study | permit | easement | other
  title: text("title").notNull(),
  scheduledOn: text("scheduled_on").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(120),
  assigneeUserId: integer("assignee_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  assigneeName: text("assignee_name"),
  buildingNum: integer("building_num").references(() => buildingsTable.num),
  vendorId: integer("vendor_id").references(() => vendorsTable.id),
  agency: text("agency"), // city/county source for permits & easements
  status: text("status").notNull().default("scheduled"), // scheduled | completed | cancelled
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
});
export type Inspection = typeof inspectionsTable.$inferSelect;

export const lifecycleItemsTable = pgTable("lifecycle_items", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(), // roof_inspection | paint_cycle | fence_repair | parking_reseal | drainage_cleanout | equipment | seasonal | other
  title: text("title").notNull(),
  buildingNum: integer("building_num").references(() => buildingsTable.num),
  lastDoneOn: text("last_done_on"),
  intervalMonths: integer("interval_months").notNull().default(12),
  // For equipment items: track service history
  equipmentName: text("equipment_name"),
  // For seasonal: optional explicit recurrence (YEARLY)
  recurrence: jsonb("recurrence").$type<CalendarRecurrence>(),
  checklist: jsonb("checklist").$type<string[]>().notNull().default([]),
  notes: text("notes").notNull().default(""),
  active: boolean("active").notNull().default(true),
  createdAt: text("created_at").notNull(),
});
export type LifecycleItem = typeof lifecycleItemsTable.$inferSelect;

export const vendorCertificatesTable = pgTable("vendor_certificates", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id").notNull().references(() => vendorsTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // coi | w9 | license
  expiresOn: text("expires_on").notNull(),
  documentStorageKey: text("document_storage_key"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
});
export type VendorCertificate = typeof vendorCertificatesTable.$inferSelect;

// ── Task #78: Trash & bulk-pickup holiday shift overrides ─────────────────
// Maps a holiday date to a shift rule (e.g. "Thursday pickup moves to
// Friday after Thanksgiving"). Used by the trash schedule materializer to
// apply per-week overrides on the base recurring trash/recycling events.
export const trashHolidayShiftsTable = pgTable("trash_holiday_shifts", {
  id: serial("id").primaryKey(),
  holidayDate: text("holiday_date").notNull(), // YYYY-MM-DD
  label: text("label").notNull(),              // e.g. "Thanksgiving"
  shiftDays: integer("shift_days").notNull(),  // +1 = next day, -1 = day before
  // Optional comma-separated weekday filter (e.g. "thu,fri") — when set,
  // only pickup days matching one of these weekdays are shifted.
  weekdays: text("weekdays").notNull().default(""),
  createdAt: text("created_at").notNull(),
}, (t) => [unique().on(t.holidayDate, t.label)]);

export type TrashHolidayShift = typeof trashHolidayShiftsTable.$inferSelect;

// ── Task #78: Public signed share-link tokens for community calendar ─────
// Admins generate a token covering selected sub-calendar slugs; the public
// /public/calendar/:token endpoint renders the read-only view. Tokens are
// rotatable (revokedAt set when superseded).
export const calendarShareTokensTable = pgTable("calendar_share_tokens", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  label: text("label").notNull().default("Community share link"),
  subCalendarSlugs: jsonb("sub_calendar_slugs").notNull().$type<string[]>().default([]),
  createdByUserId: integer("created_by_user_id"),
  createdAt: text("created_at").notNull(),
  revokedAt: text("revoked_at"),
});

export type CalendarShareToken = typeof calendarShareTokensTable.$inferSelect;

// ── Task #86: EV chargers & metered amenities ───────────────────────────

export type ChargingPortMode = "reserved" | "fcfs" | "reserved_fcfs";
export type ChargingPortProvider = "manual" | "stub_http" | "ocpp16";
export type ChargingPortConnector = "J1772" | "CCS" | "NACS" | "CHAdeMO";

export const chargingPortsTable = pgTable("charging_ports", {
  id: serial("id").primaryKey(),
  amenityId: integer("amenity_id")
    .notNull()
    .references(() => amenitiesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  location: text("location").notNull().default(""),
  connectorType: text("connector_type").$type<ChargingPortConnector>().notNull().default("J1772"),
  maxKw: integer("max_kw").notNull().default(7),
  mode: text("mode").$type<ChargingPortMode>().notNull().default("reserved"),
  provider: text("provider").$type<ChargingPortProvider>().notNull().default("manual"),
  providerConfig: jsonb("provider_config").$type<Record<string, string>>().notNull().default({}),
  perKwhCents: integer("per_kwh_cents").notNull().default(35),
  idlePerMinuteCents: integer("idle_per_minute_cents").notNull().default(40),
  idleGraceMinutes: integer("idle_grace_minutes").notNull().default(10),
  idleCapCents: integer("idle_cap_cents").notNull().default(2000),
  noShowFeeCents: integer("no_show_fee_cents").notNull().default(0),
  noShowGraceMinutes: integer("no_show_grace_minutes").notNull().default(15),
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type ChargingPort = typeof chargingPortsTable.$inferSelect;

export type ChargingReservationStatus =
  | "pending"
  | "active"
  | "completed"
  | "cancelled"
  | "no_show";

export const chargingReservationsTable = pgTable("charging_reservations", {
  id: serial("id").primaryKey(),
  portId: integer("port_id")
    .notNull()
    .references(() => chargingPortsTable.id, { onDelete: "cascade" }),
  ownerUserId: integer("owner_user_id").notNull(),
  unitId: text("unit_id"),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  status: text("status").$type<ChargingReservationStatus>().notNull().default("pending"),
  sessionId: integer("session_id"),
  noShowFeeLedgerEntryId: integer("no_show_fee_ledger_entry_id"),
  cancelledAt: text("cancelled_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type ChargingReservation = typeof chargingReservationsTable.$inferSelect;

export type ChargingSessionStatus = "active" | "stopped" | "billed" | "refunded" | "cancelled";

export const chargingSessionsTable = pgTable("charging_sessions", {
  id: serial("id").primaryKey(),
  portId: integer("port_id")
    .notNull()
    .references(() => chargingPortsTable.id, { onDelete: "restrict" }),
  reservationId: integer("reservation_id"),
  ownerUserId: integer("owner_user_id").notNull(),
  unitId: text("unit_id"),
  startAt: text("start_at").notNull(),
  endAt: text("end_at"),
  scheduledEndAt: text("scheduled_end_at"),
  kwh: numeric("kwh", { precision: 12, scale: 4 }).notNull().default("0"),
  meterStartKwh: numeric("meter_start_kwh", { precision: 12, scale: 4 }),
  meterEndKwh: numeric("meter_end_kwh", { precision: 12, scale: 4 }),
  energyCostCents: integer("energy_cost_cents").notNull().default(0),
  idleMinutes: integer("idle_minutes").notNull().default(0),
  idleCostCents: integer("idle_cost_cents").notNull().default(0),
  costCents: integer("cost_cents").notNull().default(0),
  status: text("status").$type<ChargingSessionStatus>().notNull().default("active"),
  providerSessionRef: text("provider_session_ref"),
  ledgerEntryId: integer("ledger_entry_id"),
  refundLedgerEntryId: integer("refund_ledger_entry_id"),
  refundReason: text("refund_reason"),
  lastPolledAt: text("last_polled_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type ChargingSession = typeof chargingSessionsTable.$inferSelect;

export const chargingSessionUsageSamplesTable = pgTable("charging_session_usage_samples", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => chargingSessionsTable.id, { onDelete: "cascade" }),
  sampledAt: text("sampled_at").notNull(),
  kwh: numeric("kwh", { precision: 12, scale: 4 }).notNull(),
  powerKw: numeric("power_kw", { precision: 10, scale: 3 }),
});

export type ChargingSessionUsageSample = typeof chargingSessionUsageSamplesTable.$inferSelect;

export const chargingSessionAuditTable = pgTable("charging_session_audit", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  action: text("action").notNull(),
  actorUserId: integer("actor_user_id"),
  actorName: text("actor_name").notNull().default(""),
  diff: jsonb("diff"),
  createdAt: text("created_at").notNull(),
});

export type ChargingSessionAudit = typeof chargingSessionAuditTable.$inferSelect;

export const chargingIdleEventsTable = pgTable("charging_idle_events", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => chargingSessionsTable.id, { onDelete: "cascade" }),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
  minutes: integer("minutes").notNull().default(0),
  feeCents: integer("fee_cents").notNull().default(0),
});

export type ChargingIdleEvent = typeof chargingIdleEventsTable.$inferSelect;

// ── Task #82: Amenity access control ─────────────────────────────────────

export const amenityAccessProvidersTable = pgTable("amenity_access_providers", {
  id: serial("id").primaryKey(),
  amenityId: integer("amenity_id").notNull().unique().references(() => amenitiesTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("none"), // 'none' | 'virtual_lock' | 'stub_http'
  baseUrlEnvVar: text("base_url_env_var"),
  apiKeyEnvVar: text("api_key_env_var"),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type AmenityAccessProvider = typeof amenityAccessProvidersTable.$inferSelect;

export const amenityAccessCodesTable = pgTable("amenity_access_codes", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().unique().references(() => amenityBookingsTable.id, { onDelete: "cascade" }),
  amenityId: integer("amenity_id").notNull().references(() => amenitiesTable.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  qrPayload: text("qr_payload").notNull(),
  validFrom: text("valid_from").notNull(),
  validTo: text("valid_to").notNull(),
  status: text("status").notNull().default("active"), // 'active' | 'revoked' | 'expired'
  providerKind: text("provider_kind").notNull().default("none"),
  providerRef: text("provider_ref"),
  issuedAt: text("issued_at").notNull(),
  revokedAt: text("revoked_at"),
});

export type AmenityAccessCode = typeof amenityAccessCodesTable.$inferSelect;

export const fobInventoryTable = pgTable("fob_inventory", {
  id: serial("id").primaryKey(),
  serial: text("serial").notNull().unique(),
  status: text("status").notNull().default("available"), // available, assigned, lost, retired
  zoneTags: jsonb("zone_tags").$type<string[]>().notNull().default([]),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type FobInventory = typeof fobInventoryTable.$inferSelect;

export const fobAssignmentsTable = pgTable("fob_assignments", {
  id: serial("id").primaryKey(),
  fobId: integer("fob_id").notNull().references(() => fobInventoryTable.id, { onDelete: "cascade" }),
  unitId: text("unit_id").references(() => unitsTable.id, { onDelete: "set null" }),
  bookingId: integer("booking_id").references(() => amenityBookingsTable.id, { onDelete: "set null" }),
  assignedToUserId: integer("assigned_to_user_id"),
  assignedToName: text("assigned_to_name").notNull().default(""),
  assignedAt: text("assigned_at").notNull(),
  returnedAt: text("returned_at"),
  returnedNote: text("returned_note").notNull().default(""),
  assignedByUserId: integer("assigned_by_user_id"),
});

export type FobAssignment = typeof fobAssignmentsTable.$inferSelect;

export const poolTagsTable = pgTable("pool_tags", {
  id: serial("id").primaryKey(),
  unitId: text("unit_id").notNull().references(() => unitsTable.id, { onDelete: "cascade" }),
  residentUserId: integer("resident_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  residentName: text("resident_name").notNull().default(""),
  photoStorageKey: text("photo_storage_key"),
  expiresAt: text("expires_at"),
  status: text("status").notNull().default("active"), // active, suspended, expired
  suspendedReason: text("suspended_reason").notNull().default(""),
  suspendedAt: text("suspended_at"),
  issuedAt: text("issued_at").notNull(),
  issuedByUserId: integer("issued_by_user_id"),
  updatedAt: text("updated_at").notNull(),
});

export type PoolTag = typeof poolTagsTable.$inferSelect;

export const unitVehiclesTable = pgTable("unit_vehicles", {
  id: serial("id").primaryKey(),
  unitId: text("unit_id").notNull().references(() => unitsTable.id, { onDelete: "cascade" }),
  plate: text("plate").notNull(),
  state: text("state").notNull().default(""),
  make: text("make").notNull().default(""),
  model: text("model").notNull().default(""),
  color: text("color").notNull().default(""),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type UnitVehicle = typeof unitVehiclesTable.$inferSelect;

export const bookingGuestPassesTable = pgTable("booking_guest_passes", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().references(() => amenityBookingsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  plate: text("plate").notNull().default(""),
  vehicleDesc: text("vehicle_desc").notNull().default(""),
  checkedInAt: text("checked_in_at"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export type BookingGuestPass = typeof bookingGuestPassesTable.$inferSelect;

export const amenityAccessAuditTable = pgTable("amenity_access_audit", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id"),
  amenityId: integer("amenity_id"),
  accessCodeId: integer("access_code_id"),
  providerKind: text("provider_kind").notNull().default("none"),
  action: text("action").notNull(), // issue, revoke, validate, test, validate_plate, validate_fob
  success: boolean("success").notNull().default(true),
  actorUserId: integer("actor_user_id"),
  actorName: text("actor_name").notNull().default(""),
  message: text("message").notNull().default(""),
  payload: jsonb("payload"),
  createdAt: text("created_at").notNull(),
});

export type AmenityAccessAudit = typeof amenityAccessAuditTable.$inferSelect;

// ── Task #87: Mail & Package Room ────────────────────────────────────────

export type PackageCarrier = "USPS" | "UPS" | "FedEx" | "Amazon" | "DHL" | "Other";
export type PackageSize = "letter" | "small" | "medium" | "large" | "oversized";
export type PackageStatus =
  | "received"
  | "in_locker"
  | "ready_for_pickup"
  | "picked_up"
  | "stale"
  | "return_to_sender"
  | "returned";

export const packageLockersTable = pgTable("package_lockers", {
  id: serial("id").primaryKey(),
  bankSlug: text("bank_slug").notNull().default("default"),
  bay: text("bay").notNull(),
  size: text("size").$type<PackageSize>().notNull().default("medium"),
  notes: text("notes").notNull().default(""),
  outOfService: boolean("out_of_service").notNull().default(false),
  createdAt: text("created_at").notNull(),
}, (t) => [unique().on(t.bankSlug, t.bay)]);

export type PackageLocker = typeof packageLockersTable.$inferSelect;

export const packagesTable = pgTable("packages", {
  id: serial("id").primaryKey(),
  unitId: text("unit_id").notNull().references(() => unitsTable.id, { onDelete: "cascade" }),
  recipientUserId: integer("recipient_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  recipientName: text("recipient_name").notNull().default(""),
  carrier: text("carrier").$type<PackageCarrier>().notNull().default("Other"),
  trackingNumber: text("tracking_number").notNull().default(""),
  size: text("size").$type<PackageSize>().notNull().default("medium"),
  notes: text("notes").notNull().default(""),
  intakePhotoStorageKey: text("intake_photo_storage_key"),
  pickupPhotoStorageKey: text("pickup_photo_storage_key"),
  pickupCode: text("pickup_code").notNull().unique(),
  qrPayload: text("qr_payload").notNull(),
  lockerId: integer("locker_id").references(() => packageLockersTable.id, { onDelete: "set null" }),
  lockerPin: text("locker_pin"),
  status: text("status").$type<PackageStatus>().notNull().default("received"),
  heldUntil: text("held_until"), // vacation hold flag
  staleAt: text("stale_at"),
  rtsAt: text("rts_at"),
  pickedUpAt: text("picked_up_at"),
  pickedUpByName: text("picked_up_by_name").notNull().default(""),
  pickedUpByUserId: integer("picked_up_by_user_id"),
  intakeByUserId: integer("intake_by_user_id"),
  intakeByName: text("intake_by_name").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type Package = typeof packagesTable.$inferSelect;

export const packagePickupAuthorizationsTable = pgTable("package_pickup_authorizations", {
  id: serial("id").primaryKey(),
  packageId: integer("package_id").notNull().references(() => packagesTable.id, { onDelete: "cascade" }),
  authorizedName: text("authorized_name").notNull(),
  authorizedUserId: integer("authorized_user_id"),
  note: text("note").notNull().default(""),
  createdByUserId: integer("created_by_user_id"),
  createdAt: text("created_at").notNull(),
});

export type PackagePickupAuthorization = typeof packagePickupAuthorizationsTable.$inferSelect;

export const packageAuditTable = pgTable("package_audit", {
  id: serial("id").primaryKey(),
  packageId: integer("package_id").notNull(),
  action: text("action").notNull(),
  actorUserId: integer("actor_user_id"),
  actorName: text("actor_name").notNull().default(""),
  diff: jsonb("diff"),
  createdAt: text("created_at").notNull(),
});

export type PackageAudit = typeof packageAuditTable.$inferSelect;

export const mailHoldWindowsTable = pgTable("mail_hold_windows", {
  id: serial("id").primaryKey(),
  unitId: text("unit_id").notNull().references(() => unitsTable.id, { onDelete: "cascade" }),
  startsOn: text("starts_on").notNull(), // YYYY-MM-DD
  endsOn: text("ends_on").notNull(),
  note: text("note").notNull().default(""),
  createdByUserId: integer("created_by_user_id"),
  createdAt: text("created_at").notNull(),
});

export type MailHoldWindow = typeof mailHoldWindowsTable.$inferSelect;

// ── Task #83: Amenity inspections, damage, deposits, pool chemistry ──

export type AmenityInspectionTemplateKind = "pre" | "post" | "owner_self";

export const amenityInspectionTemplatesTable = pgTable("amenity_inspection_templates", {
  id: serial("id").primaryKey(),
  amenitySlug: text("amenity_slug"),
  name: text("name").notNull(),
  kind: text("kind").$type<AmenityInspectionTemplateKind>().notNull(),
  description: text("description").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type AmenityInspectionTemplate = typeof amenityInspectionTemplatesTable.$inferSelect;

export type AmenityInspectionItemSeverity = "info" | "warn" | "critical";

export const amenityInspectionTemplateItemsTable = pgTable("amenity_inspection_template_items", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id")
    .notNull()
    .references(() => amenityInspectionTemplatesTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  helpText: text("help_text").notNull().default(""),
  requiresPhoto: boolean("requires_photo").notNull().default(false),
  severity: text("severity").$type<AmenityInspectionItemSeverity>().notNull().default("warn"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export type AmenityInspectionTemplateItem = typeof amenityInspectionTemplateItemsTable.$inferSelect;

export type AmenityInspectionStatus = "draft" | "submitted";

export const amenityInspectionsTable = pgTable("amenity_inspections", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id")
    .notNull()
    .references(() => amenityBookingsTable.id, { onDelete: "cascade" }),
  templateId: integer("template_id"),
  kind: text("kind").$type<AmenityInspectionTemplateKind>().notNull(),
  status: text("status").$type<AmenityInspectionStatus>().notNull().default("draft"),
  inspectorUserId: integer("inspector_user_id"),
  inspectorName: text("inspector_name").notNull().default(""),
  inspectorRole: text("inspector_role").notNull().default(""),
  notes: text("notes").notNull().default(""),
  signature: text("signature").notNull().default(""),
  performedAt: text("performed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type AmenityInspection = typeof amenityInspectionsTable.$inferSelect;

export type AmenityInspectionItemStatus = "ok" | "flagged" | "na";

export const amenityInspectionItemResultsTable = pgTable("amenity_inspection_item_results", {
  id: serial("id").primaryKey(),
  inspectionId: integer("inspection_id")
    .notNull()
    .references(() => amenityInspectionsTable.id, { onDelete: "cascade" }),
  templateItemId: integer("template_item_id"),
  label: text("label").notNull(),
  status: text("status").$type<AmenityInspectionItemStatus>().notNull().default("ok"),
  note: text("note").notNull().default(""),
  photoStorageKey: text("photo_storage_key"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export type AmenityInspectionItemResult = typeof amenityInspectionItemResultsTable.$inferSelect;

export type AmenityDamageReportStatus =
  | "open"
  | "charged"
  | "waived"
  | "disputed"
  | "resolved";

export const amenityDamageReportsTable = pgTable("amenity_damage_reports", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id")
    .notNull()
    .references(() => amenityBookingsTable.id, { onDelete: "cascade" }),
  inspectionId: integer("inspection_id"),
  reportedByUserId: integer("reported_by_user_id"),
  reportedByName: text("reported_by_name").notNull().default(""),
  summary: text("summary").notNull().default(""),
  details: text("details").notNull().default(""),
  estimatedCostCents: integer("estimated_cost_cents").notNull().default(0),
  depositChargedCents: integer("deposit_charged_cents").notNull().default(0),
  photoStorageKeys: jsonb("photo_storage_keys").$type<string[]>().notNull().default([]),
  status: text("status").$type<AmenityDamageReportStatus>().notNull().default("open"),
  workOrderId: text("work_order_id"),
  managerNotes: text("manager_notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  resolvedAt: text("resolved_at"),
});

export type AmenityDamageReport = typeof amenityDamageReportsTable.$inferSelect;

export type AmenityDamageDisputeStatus =
  | "open"
  | "under_review"
  | "upheld"
  | "denied";

export const amenityDamageDisputesTable = pgTable("amenity_damage_disputes", {
  id: serial("id").primaryKey(),
  damageReportId: integer("damage_report_id")
    .notNull()
    .references(() => amenityDamageReportsTable.id, { onDelete: "cascade" }),
  ownerUserId: integer("owner_user_id").notNull(),
  ownerName: text("owner_name").notNull().default(""),
  message: text("message").notNull().default(""),
  evidenceStorageKeys: jsonb("evidence_storage_keys").$type<string[]>().notNull().default([]),
  status: text("status").$type<AmenityDamageDisputeStatus>().notNull().default("open"),
  managerResponse: text("manager_response").notNull().default(""),
  resolvedByUserId: integer("resolved_by_user_id"),
  resolvedAt: text("resolved_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── Task #84: Amenity Guest Parking & Vehicle Registry ───────────────────

export type GuestParkingPermitStatus =
  | "active"
  | "cancelled"
  | "expired";

export const guestParkingPermitsTable = pgTable("guest_parking_permits", {
  id: serial("id").primaryKey(),
  unitId: text("unit_id").notNull().references(() => unitsTable.id, { onDelete: "cascade" }),
  ownerUserId: integer("owner_user_id").notNull(),
  permitNumber: text("permit_number").notNull().unique(),
  numberYear: integer("number_year").notNull(),
  numberSeq: integer("number_seq").notNull(),
  // Inclusive calendar nights — startsOn = first night, endsOn = last night.
  startsOn: text("starts_on").notNull(), // YYYY-MM-DD
  endsOn: text("ends_on").notNull(),     // YYYY-MM-DD
  nights: integer("nights").notNull(),
  guestName: text("guest_name").notNull().default(""),
  plate: text("plate").notNull(),
  plateState: text("plate_state").notNull().default(""),
  vehicleMake: text("vehicle_make").notNull().default(""),
  vehicleModel: text("vehicle_model").notNull().default(""),
  vehicleColor: text("vehicle_color").notNull().default(""),
  vehicleDesc: text("vehicle_desc").notNull().default(""),
  notes: text("notes").notNull().default(""),
  status: text("status").$type<GuestParkingPermitStatus>().notNull().default("active"),
  agreementSignedName: text("agreement_signed_name").notNull().default(""),
  agreementSignedAt: text("agreement_signed_at"),
  agreementSignedIp: text("agreement_signed_ip"),
  qrToken: text("qr_token").notNull().unique(),
  pdfStorageKey: text("pdf_storage_key"),
  cancelledAt: text("cancelled_at"),
  cancelledByUserId: integer("cancelled_by_user_id"),
  cancellationReason: text("cancellation_reason").notNull().default(""),
  createdByUserId: integer("created_by_user_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── Task #85: Pet registry & dog-park module ─────────────────────────────

export type PetSpecies = "dog" | "cat" | "other";
export type PetSex = "male" | "female" | "unknown";
export type PetStatus = "compliant" | "expiring_soon" | "non_compliant" | "pending_approval" | "suspended";

export const petsTable = pgTable("pets", {
  id: serial("id").primaryKey(),
  unitId: text("unit_id").notNull().references(() => unitsTable.id, { onDelete: "cascade" }),
  filedByUserId: integer("filed_by_user_id"),
  filedByName: text("filed_by_name").notNull().default(""),
  name: text("name").notNull(),
  species: text("species").$type<PetSpecies>().notNull().default("dog"),
  breed: text("breed").notNull().default(""),
  weightLbs: integer("weight_lbs").notNull().default(0),
  sex: text("sex").$type<PetSex>().notNull().default("unknown"),
  spayedNeutered: boolean("spayed_neutered").notNull().default(false),
  color: text("color").notNull().default(""),
  photoStorageKey: text("photo_storage_key"),
  microchipNumber: text("microchip_number").notNull().default(""),
  vetName: text("vet_name").notNull().default(""),
  vetPhone: text("vet_phone").notNull().default(""),
  notes: text("notes").notNull().default(""),
  // Computed status; recomputed nightly and on writes.
  status: text("status").$type<PetStatus>().notNull().default("non_compliant"),
  // Owner-approval workflow: tenants file, owner approves before published.
  approvalState: text("approval_state").notNull().default("approved"), // approved | pending | rejected
  approvedByUserId: integer("approved_by_user_id"),
  approvedAt: text("approved_at"),
  // Suspension (set by incidents threshold)
  suspendedUntil: text("suspended_until"),
  suspendedReason: text("suspended_reason").notNull().default(""),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type AmenityDamageDispute = typeof amenityDamageDisputesTable.$inferSelect;

export type AmenityDepositLedgerKind =
  | "held"
  | "released"
  | "charged"
  | "refunded"
  | "adjusted";

export const amenityDepositLedgerTable = pgTable("amenity_deposit_ledger", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id")
    .notNull()
    .references(() => amenityBookingsTable.id, { onDelete: "cascade" }),
  kind: text("kind").$type<AmenityDepositLedgerKind>().notNull(),
  amountCents: integer("amount_cents").notNull().default(0),
  balanceCents: integer("balance_cents").notNull().default(0),
  reason: text("reason").notNull().default(""),
  damageReportId: integer("damage_report_id"),
  actorUserId: integer("actor_user_id"),
  actorName: text("actor_name").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export type AmenityDepositLedger = typeof amenityDepositLedgerTable.$inferSelect;

export const poolChemistryLogsTable = pgTable("pool_chemistry_logs", {
  id: serial("id").primaryKey(),
  recordedAt: text("recorded_at").notNull(),
  recordedByUserId: integer("recorded_by_user_id"),
  recordedByName: text("recorded_by_name").notNull().default(""),
  freeChlorinePpm: doublePrecision("free_chlorine_ppm"),
  totalChlorinePpm: doublePrecision("total_chlorine_ppm"),
  ph: doublePrecision("ph"),
  alkalinityPpm: doublePrecision("alkalinity_ppm"),
  calciumHardnessPpm: doublePrecision("calcium_hardness_ppm"),
  cyanuricAcidPpm: doublePrecision("cyanuric_acid_ppm"),
  temperatureF: doublePrecision("temperature_f"),
  notes: text("notes").notNull().default(""),
  flagged: boolean("flagged").notNull().default(false),
  flagReasons: jsonb("flag_reasons").$type<string[]>().notNull().default([]),
  workOrderId: text("work_order_id"),
  createdAt: text("created_at").notNull(),
});

export type PoolChemistryLog = typeof poolChemistryLogsTable.$inferSelect;

export type GuestParkingPermit = typeof guestParkingPermitsTable.$inferSelect;

export interface GuestParkingSettingsValue {
  perUnitNightlyCap: number;        // default 14
  rollingWindowDays: number;        // default 30
  maxConsecutiveNights: number;     // default 7
  maxAdvanceDays: number;           // default 30
  requireAccountCurrent: boolean;   // gate
  requireNoOpenViolations: boolean; // gate
  excludeRegisteredVehicles: boolean; // owners' own plates blocked from guest permits
  agreementText: string;
}

export const guestParkingSettingsTable = pgTable("guest_parking_settings", {
  id: serial("id").primaryKey(),
  // Singleton row keyed on org-level config (id=1)
  config: jsonb("config").$type<GuestParkingSettingsValue>().notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedByUserId: integer("updated_by_user_id"),
});

export type GuestParkingSettings = typeof guestParkingSettingsTable.$inferSelect;

export const guestParkingLookupsTable = pgTable("guest_parking_lookups", {
  id: serial("id").primaryKey(),
  query: text("query").notNull(),
  plate: text("plate").notNull().default(""),
  result: text("result").notNull(), // 'permitted' | 'unregistered' | 'registered_resident' | 'expired' | 'cancelled'
  permitId: integer("permit_id"),
  unitId: text("unit_id"),
  patrolUserId: integer("patrol_user_id"),
  patrolName: text("patrol_name").notNull().default(""),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export type GuestParkingLookup = typeof guestParkingLookupsTable.$inferSelect;

export type Pet = typeof petsTable.$inferSelect;

export const petVaccinationsTable = pgTable("pet_vaccinations", {
  id: serial("id").primaryKey(),
  petId: integer("pet_id").notNull().references(() => petsTable.id, { onDelete: "cascade" }),
  vaccineType: text("vaccine_type").notNull(), // rabies, dhpp, bordetella, leptospirosis, fvrcp, other
  administeredOn: text("administered_on").notNull(), // YYYY-MM-DD
  expiresOn: text("expires_on").notNull(),           // YYYY-MM-DD
  certificateStorageKey: text("certificate_storage_key"),
  notes: text("notes").notNull().default(""),
  uploadedByUserId: integer("uploaded_by_user_id"),
  uploadedByName: text("uploaded_by_name").notNull().default(""),
  // Reminders sent (so we don't re-send): each entry is e.g. "30","14","1","day_of"
  remindersSent: jsonb("reminders_sent").$type<string[]>().notNull().default([]),
  createdAt: text("created_at").notNull(),
});

export type PetVaccination = typeof petVaccinationsTable.$inferSelect;

export const petDogparkAgreementsTable = pgTable("pet_dogpark_agreements", {
  id: serial("id").primaryKey(),
  unitId: text("unit_id").notNull().references(() => unitsTable.id, { onDelete: "cascade" }),
  signedByUserId: integer("signed_by_user_id"),
  signedByName: text("signed_by_name").notNull().default(""),
  signedIp: text("signed_ip"),
  agreementText: text("agreement_text").notNull().default(""),
  signedAt: text("signed_at").notNull(),
  expiresAt: text("expires_at").notNull(), // anniversary
});

export type PetDogparkAgreement = typeof petDogparkAgreementsTable.$inferSelect;

export const petIncidentsTable = pgTable("pet_incidents", {
  id: serial("id").primaryKey(),
  petId: integer("pet_id").notNull().references(() => petsTable.id, { onDelete: "cascade" }),
  unitId: text("unit_id").notNull(),
  occurredAt: text("occurred_at").notNull(),
  kind: text("kind").notNull(), // bite, off_leash, aggressive, waste, other
  severity: text("severity").notNull().default("minor"), // minor | major | severe
  description: text("description").notNull().default(""),
  reportedByUserId: integer("reported_by_user_id"),
  reportedByName: text("reported_by_name").notNull().default(""),
  resolution: text("resolution").notNull().default(""),
  resolvedAt: text("resolved_at"),
  resolvedByUserId: integer("resolved_by_user_id"),
  // 'open' | 'reviewed' | 'dismissed'
  status: text("status").notNull().default("open"),
  createdAt: text("created_at").notNull(),
});

export type PetIncident = typeof petIncidentsTable.$inferSelect;

export interface DogParkSettings {
  // off-leash blocks per weekday: 0=Sun..6=Sat. each: { start: "HH:MM", end: "HH:MM" }
  offLeashByWeekday?: Array<Array<{ start: string; end: string }>>;
  restrictedBreeds?: string[]; // case-insensitive contains match
  enforceBreedRestriction?: boolean;
  maxWeightLbs?: number; // 0 = unlimited
  enforceWeightRestriction?: boolean;
  incidentSuspensionThreshold?: number; // count of incidents
  incidentSuspensionWindowDays?: number;
  incidentSuspensionDurationDays?: number;
  agreementText?: string;
  ownerApprovalRequiredForTenants?: boolean;
}

export const dogParkSettingsTable = pgTable("dog_park_amenity_settings", {
  id: serial("id").primaryKey(),
  amenityId: integer("amenity_id").notNull().unique().references(() => amenitiesTable.id, { onDelete: "cascade" }),
  settings: jsonb("settings").$type<DogParkSettings>().notNull().default({}),
  updatedAt: text("updated_at").notNull(),
});

export type DogParkSettingsRow = typeof dogParkSettingsTable.$inferSelect;

export const petAuditTable = pgTable("pet_audit", {
  id: serial("id").primaryKey(),
  petId: integer("pet_id"),
  unitId: text("unit_id"),
  action: text("action").notNull(), // created, edited, vaccination_added, status_changed, incident, suspended, restored, agreement_signed, deleted
  actorUserId: integer("actor_user_id"),
  actorName: text("actor_name").notNull().default(""),
  diff: jsonb("diff"),
  createdAt: text("created_at").notNull(),
});

export type PetAudit = typeof petAuditTable.$inferSelect;

// ── Task #89: Amenity Compliance & Safety Records ────────────────────────

export type AmenityPostingKind =
  | "occupancy_card"
  | "pool_rules"
  | "depth_markers"
  | "no_lifeguard_warning"
  | "emergency_911"
  | "evacuation_map"
  | "aed_location"
  | "permit"
  | "insurance"
  | "other";

export const amenityRequiredPostingsTable = pgTable("amenity_required_postings", {
  id: serial("id").primaryKey(),
  amenityId: integer("amenity_id").notNull().references(() => amenitiesTable.id, { onDelete: "cascade" }),
  kind: text("kind").$type<AmenityPostingKind>().notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  // Body template used to render the printable poster. May contain merge
  // tokens like {{orgName}}, {{amenityName}}, {{capacity}}, {{permit}}.
  templateBody: text("template_body").notNull().default(""),
  // How often the printed poster must be replaced (0 = never).
  replaceEveryDays: integer("replace_every_days").notNull().default(0),
  required: boolean("required").notNull().default(true),
  citation: text("citation").notNull().default(""), // ordinance / code reference
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export type AmenityRequiredPosting = typeof amenityRequiredPostingsTable.$inferSelect;

export type AmenityPostingIssuanceStatus = "active" | "superseded" | "removed";

export const amenityPostingIssuancesTable = pgTable("amenity_posting_issuances", {
  id: serial("id").primaryKey(),
  postingId: integer("posting_id").notNull().references(() => amenityRequiredPostingsTable.id, { onDelete: "cascade" }),
  amenityId: integer("amenity_id").notNull().references(() => amenitiesTable.id, { onDelete: "cascade" }),
  // Snapshot of rendered body and template values at time of printing.
  renderedBody: text("rendered_body").notNull().default(""),
  documentStorageKey: text("document_storage_key"),
  postedAt: text("posted_at").notNull(),
  postedByUserId: integer("posted_by_user_id"),
  postedByName: text("posted_by_name").notNull().default(""),
  expiresAt: text("expires_at"),
  status: text("status").$type<AmenityPostingIssuanceStatus>().notNull().default("active"),
  removedAt: text("removed_at"),
  removedReason: text("removed_reason").notNull().default(""),
  createdAt: text("created_at").notNull(),
});
export type AmenityPostingIssuance = typeof amenityPostingIssuancesTable.$inferSelect;

export type AmenityCertificateKind =
  | "permit"           // city/county operational permit
  | "insurance"        // amenity-specific liability rider
  | "inspection_cert"  // health-department or fire pass
  | "vendor_coi"       // vendor certificate of insurance scoped to amenity
  | "license"
  | "other";

export const amenityCertificatesTable = pgTable("amenity_certificates", {
  id: serial("id").primaryKey(),
  amenityId: integer("amenity_id").notNull().references(() => amenitiesTable.id, { onDelete: "cascade" }),
  kind: text("kind").$type<AmenityCertificateKind>().notNull(),
  title: text("title").notNull(),
  issuer: text("issuer").notNull().default(""),
  identifier: text("identifier").notNull().default(""), // permit / policy #
  vendorId: integer("vendor_id").references(() => vendorsTable.id, { onDelete: "set null" }),
  effectiveOn: text("effective_on"),
  expiresOn: text("expires_on"),
  documentStorageKey: text("document_storage_key"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export type AmenityCertificate = typeof amenityCertificatesTable.$inferSelect;

export type AmenityAnnualInspectionStatus = "scheduled" | "in_progress" | "passed" | "failed" | "cancelled";

export const amenityAnnualInspectionsTable = pgTable("amenity_annual_inspections", {
  id: serial("id").primaryKey(),
  amenityId: integer("amenity_id").notNull().references(() => amenitiesTable.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  scheduledOn: text("scheduled_on").notNull(),
  performedOn: text("performed_on"),
  inspectorName: text("inspector_name").notNull().default(""),
  inspectorAgency: text("inspector_agency").notNull().default(""),
  inspectorUserId: integer("inspector_user_id"),
  status: text("status").$type<AmenityAnnualInspectionStatus>().notNull().default("scheduled"),
  // Optional checklist items captured as a lightweight inline JSON list so
  // we don't need a third table; each item has { label, status, note }.
  checklist: jsonb("checklist").$type<Array<{ label: string; status: "ok" | "flagged" | "na"; note?: string; photoStorageKey?: string | null }>>().notNull().default([]),
  reportStorageKey: text("report_storage_key"),
  notes: text("notes").notNull().default(""),
  workOrderIds: jsonb("work_order_ids").$type<string[]>().notNull().default([]),
  calendarEventId: integer("calendar_event_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export type AmenityAnnualInspection = typeof amenityAnnualInspectionsTable.$inferSelect;

export type AmenityIncidentSeverity = "minor" | "moderate" | "major";
export type AmenityIncidentStatus = "open" | "follow_up" | "closed";
export type AmenityIncidentKind =
  | "injury" | "near_miss" | "drowning" | "ems_called"
  | "vandalism" | "theft" | "rule_violation" | "equipment_failure" | "other";

export const amenityIncidentReportsTable = pgTable("amenity_incident_reports", {
  id: serial("id").primaryKey(),
  amenityId: integer("amenity_id").notNull().references(() => amenitiesTable.id, { onDelete: "cascade" }),
  bookingId: integer("booking_id").references(() => amenityBookingsTable.id, { onDelete: "set null" }),
  occurredAt: text("occurred_at").notNull(),
  reportedAt: text("reported_at").notNull(),
  reportedByUserId: integer("reported_by_user_id"),
  reportedByName: text("reported_by_name").notNull().default(""),
  reportedByRole: text("reported_by_role").notNull().default(""),
  kind: text("kind").$type<AmenityIncidentKind>().notNull(),
  severity: text("severity").$type<AmenityIncidentSeverity>().notNull().default("minor"),
  involvedParties: text("involved_parties").notNull().default(""),
  witnesses: text("witnesses").notNull().default(""),
  emsCalled: boolean("ems_called").notNull().default(false),
  policeCalled: boolean("police_called").notNull().default(false),
  insuranceNotified: boolean("insurance_notified").notNull().default(false),
  insuranceClaimNumber: text("insurance_claim_number").notNull().default(""),
  narrative: text("narrative").notNull().default(""),
  immediateActions: text("immediate_actions").notNull().default(""),
  followUpActions: text("follow_up_actions").notNull().default(""),
  followUpDueOn: text("follow_up_due_on"),
  status: text("status").$type<AmenityIncidentStatus>().notNull().default("open"),
  closedAt: text("closed_at"),
  closedByUserId: integer("closed_by_user_id"),
  workOrderIds: jsonb("work_order_ids").$type<string[]>().notNull().default([]),
  ownerVisible: boolean("owner_visible").notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export type AmenityIncidentReport = typeof amenityIncidentReportsTable.$inferSelect;

export const amenityIncidentAttachmentsTable = pgTable("amenity_incident_attachments", {
  id: serial("id").primaryKey(),
  incidentId: integer("incident_id").notNull().references(() => amenityIncidentReportsTable.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull(),
  caption: text("caption").notNull().default(""),
  uploadedByUserId: integer("uploaded_by_user_id"),
  uploadedByName: text("uploaded_by_name").notNull().default(""),
  createdAt: text("created_at").notNull(),
});
export type AmenityIncidentAttachment = typeof amenityIncidentAttachmentsTable.$inferSelect;

export const amenityIncidentAuditTable = pgTable("amenity_incident_audit", {
  id: serial("id").primaryKey(),
  incidentId: integer("incident_id").notNull().references(() => amenityIncidentReportsTable.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  actorUserId: integer("actor_user_id"),
  actorName: text("actor_name").notNull().default(""),
  diff: jsonb("diff"),
  createdAt: text("created_at").notNull(),
});
export type AmenityIncidentAudit = typeof amenityIncidentAuditTable.$inferSelect;

export const amenityEmergencyProceduresTable = pgTable("amenity_emergency_procedures", {
  id: serial("id").primaryKey(),
  amenityId: integer("amenity_id").notNull().unique().references(() => amenitiesTable.id, { onDelete: "cascade" }),
  emergencyContact: text("emergency_contact").notNull().default("911"),
  managerOnCallName: text("manager_on_call_name").notNull().default(""),
  managerOnCallPhone: text("manager_on_call_phone").notNull().default(""),
  evacuationRoute: text("evacuation_route").notNull().default(""),
  shelterLocation: text("shelter_location").notNull().default(""),
  hazardNotes: text("hazard_notes").notNull().default(""),
  // Step-by-step procedure: ["Call 911", "Notify lifeguard", ...]
  steps: jsonb("steps").$type<string[]>().notNull().default([]),
  postedStorageKey: text("posted_storage_key"),
  updatedAt: text("updated_at").notNull(),
  createdAt: text("created_at").notNull(),
});
export type AmenityEmergencyProcedure = typeof amenityEmergencyProceduresTable.$inferSelect;

export type AmenitySafetyPinKind =
  | "aed" | "fire_extinguisher" | "first_aid" | "rescue_hook"
  | "life_ring" | "phone" | "shut_off" | "exit" | "other";

export const amenitySafetyPinsTable = pgTable("amenity_safety_pins", {
  id: serial("id").primaryKey(),
  amenityId: integer("amenity_id").notNull().references(() => amenitiesTable.id, { onDelete: "cascade" }),
  kind: text("kind").$type<AmenitySafetyPinKind>().notNull(),
  label: text("label").notNull(),
  locationDescription: text("location_description").notNull().default(""),
  // Optional X/Y on a map image (0..1 normalized) for visual layout.
  posX: doublePrecision("pos_x"),
  posY: doublePrecision("pos_y"),
  lastCheckedOn: text("last_checked_on"),
  lastCheckedByName: text("last_checked_by_name").notNull().default(""),
  serviceDueOn: text("service_due_on"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export type AmenitySafetyPin = typeof amenitySafetyPinsTable.$inferSelect;

// ── Task #88: Amenity financials & reporting ─────────────────────────────

export type AmenityExpenseKind =
  | "cleaning"
  | "lifeguard"
  | "supplies"
  | "maintenance"
  | "utilities"
  | "permits"
  | "other";

export const amenityExpenseEntriesTable = pgTable("amenity_expense_entries", {
  id: serial("id").primaryKey(),
  amenityId: integer("amenity_id")
    .notNull()
    .references(() => amenitiesTable.id, { onDelete: "restrict" }),
  occurredOn: text("occurred_on").notNull(), // YYYY-MM-DD
  kind: text("kind").$type<AmenityExpenseKind>().notNull().default("other"),
  vendor: text("vendor").notNull().default(""),
  vendorId: integer("vendor_id"),
  description: text("description").notNull().default(""),
  amountCents: integer("amount_cents").notNull().default(0),
  invoiceRef: text("invoice_ref").notNull().default(""),
  workOrderId: text("work_order_id"),
  notes: text("notes").notNull().default(""),
  createdByUserId: integer("created_by_user_id"),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type AmenityExpenseEntry = typeof amenityExpenseEntriesTable.$inferSelect;

// ── Task #120: Building Systems file ───────────────────────────────────
export type BuildingSystemKind =
  | "roof"
  | "hvac"
  | "plumbing"
  | "electrical"
  | "foundation"
  | "exterior"
  | "fire_safety"
  | "elevator"
  | "other";

export type BuildingSystemStatus = "good" | "watch" | "action";

export const buildingSystemsTable = pgTable("building_systems", {
  id: serial("id").primaryKey(),
  building: integer("building").notNull().references(() => buildingsTable.num),
  kind: text("kind").$type<BuildingSystemKind>().notNull(),
  label: text("label").notNull(),
  installedOn: text("installed_on"),
  warrantyExpiresOn: text("warranty_expires_on"),
  manufacturer: text("manufacturer"),
  model: text("model"),
  serialNo: text("serial_no"),
  status: text("status").$type<BuildingSystemStatus>().notNull().default("good"),
  retiredOn: text("retired_on"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

export type BuildingSystem = typeof buildingSystemsTable.$inferSelect;

export const buildingSystemDocumentsTable = pgTable("building_system_documents", {
  id: serial("id").primaryKey(),
  systemId: integer("system_id").notNull().references(() => buildingSystemsTable.id, { onDelete: "cascade" }),
  documentId: text("document_id").notNull(),
  kind: text("kind").notNull().default("other"), // install | warranty | manual | inspection | repair | other
  createdAt: text("created_at").notNull(),
});

export type BuildingSystemDocument = typeof buildingSystemDocumentsTable.$inferSelect;

export const buildingSystemInspectionsTable = pgTable("building_system_inspections", {
  id: serial("id").primaryKey(),
  systemId: integer("system_id").notNull().references(() => buildingSystemsTable.id, { onDelete: "cascade" }),
  inspectedOn: text("inspected_on").notNull(),
  inspector: text("inspector"),
  summary: text("summary"),
  documentId: text("document_id"),
  createdAt: text("created_at").notNull(),
});

export type BuildingSystemInspection = typeof buildingSystemInspectionsTable.$inferSelect;

export const buildingSystemRepairsTable = pgTable("building_system_repairs", {
  id: serial("id").primaryKey(),
  systemId: integer("system_id").notNull().references(() => buildingSystemsTable.id, { onDelete: "cascade" }),
  workOrderId: text("work_order_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [unique().on(t.systemId, t.workOrderId)]);

export type BuildingSystemRepair = typeof buildingSystemRepairsTable.$inferSelect;

// ── Task #140: Glossary, contextual help, and onboarding ─────────────────

export type GlossaryCategory =
  | "governance"
  | "maintenance"
  | "property"
  | "compliance"
  | "financials"
  | "community";

export const glossaryTermsTable = pgTable("glossary_terms", {
  id: serial("id").primaryKey(),
  termKey: text("term_key").notNull().unique(), // url-safe slug
  title: text("title").notNull(),
  category: text("category").$type<GlossaryCategory>().notNull(),
  shortDef: text("short_def").notNull(),
  longDef: text("long_def").notNull().default(""),
  seeAlsoRoute: text("see_also_route"),
  published: boolean("published").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type GlossaryTerm = typeof glossaryTermsTable.$inferSelect;

export const glossaryRouteMappingsTable = pgTable("glossary_route_mappings", {
  id: serial("id").primaryKey(),
  termId: integer("term_id").notNull().references(() => glossaryTermsTable.id, { onDelete: "cascade" }),
  route: text("route").notNull(), // e.g. "/motions"
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [unique().on(t.termId, t.route)]);

export type GlossaryRouteMapping = typeof glossaryRouteMappingsTable.$inferSelect;

export const glossaryEditHistoryTable = pgTable("glossary_edit_history", {
  id: serial("id").primaryKey(),
  termId: integer("term_id").notNull(),
  termKey: text("term_key").notNull(),
  action: text("action").notNull(), // create, update, delete, accept_suggestion
  actorUserId: integer("actor_user_id"),
  actorName: text("actor_name").notNull().default(""),
  diff: jsonb("diff"),
  createdAt: text("created_at").notNull(),
});

export type GlossaryEditHistory = typeof glossaryEditHistoryTable.$inferSelect;

export type GlossarySuggestionStatus = "pending" | "accepted" | "rejected";

export const glossarySuggestionsTable = pgTable("glossary_suggestions", {
  id: serial("id").primaryKey(),
  termId: integer("term_id").notNull().references(() => glossaryTermsTable.id, { onDelete: "cascade" }),
  proposedTitle: text("proposed_title").notNull().default(""),
  proposedShortDef: text("proposed_short_def").notNull().default(""),
  proposedLongDef: text("proposed_long_def").notNull().default(""),
  reason: text("reason").notNull().default(""),
  status: text("status").$type<GlossarySuggestionStatus>().notNull().default("pending"),
  submittedByUserId: integer("submitted_by_user_id"),
  submittedByName: text("submitted_by_name").notNull().default(""),
  reviewedByUserId: integer("reviewed_by_user_id"),
  reviewedByName: text("reviewed_by_name").notNull().default(""),
  reviewNote: text("review_note").notNull().default(""),
  createdAt: text("created_at").notNull(),
  reviewedAt: text("reviewed_at"),
});

export type GlossarySuggestion = typeof glossarySuggestionsTable.$inferSelect;

export const userOnboardingTable = pgTable("user_onboarding", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  tourCompleted: boolean("tour_completed").notNull().default(false),
  tourCompletedAt: text("tour_completed_at"),
  tourReplayedAt: text("tour_replayed_at"),
  // Task #146: tracks the highest org-wide tour version this user has seen.
  // When the org bumps `organization_settings.current_tour_version` (e.g.
  // after a major release), users whose `tourVersionSeen` is below the new
  // version will see the welcome tour again automatically.
  tourVersionSeen: integer("tour_version_seen"),
  updatedAt: text("updated_at").notNull(),
});

export type UserOnboarding = typeof userOnboardingTable.$inferSelect;
