import { pgTable, foreignKey, unique, serial, integer, text, boolean, jsonb, doublePrecision, numeric } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const insurancePolicies = pgTable("insurance_policies", {
	id: serial().primaryKey().notNull(),
	building: integer().notNull(),
	carrier: text().notNull(),
	policyNo: text("policy_no").notNull(),
	coverage: integer().notNull(),
	premium: integer().notNull(),
	expires: text().notNull(),
	status: text().notNull(),
	effectiveFrom: text("effective_from"),
}, (table) => [
	foreignKey({
			columns: [table.building],
			foreignColumns: [buildings.num],
			name: "insurance_policies_building_buildings_num_fk"
		}),
	unique("insurance_policies_building_unique").on(table.building),
]);

export const vendors = pgTable("vendors", {
	id: serial().primaryKey().notNull(),
	name: text().notNull(),
	tradeCategory: text("trade_category").notNull(),
	contactName: text("contact_name").notNull(),
	phone: text().notNull(),
	email: text().notNull(),
	licenseNumber: text("license_number"),
	status: text().default('active').notNull(),
	notes: text(),
});

export const emailChangeTokens = pgTable("email_change_tokens", {
	id: serial().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	newEmail: text("new_email").notNull(),
	tokenHash: text("token_hash").notNull(),
	expiresAt: text("expires_at").notNull(),
	consumedAt: text("consumed_at"),
	createdAt: text("created_at").notNull(),
}, (table) => [
	unique("email_change_tokens_token_hash_unique").on(table.tokenHash),
]);

export const documents = pgTable("documents", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	category: text().notNull(),
	building: integer(),
	uploaded: text().notNull(),
	size: text().notNull(),
	uploadedBy: text("uploaded_by").notNull(),
	storageKey: text("storage_key"),
	driveFileId: text("drive_file_id"),
	unit: text(),
	documentDate: text("document_date"),
	isHistorical: boolean("is_historical").default(false).notNull(),
	source: text().default('original').notNull(),
	importBatchId: text("import_batch_id"),
	notes: text(),
	vendorId: integer("vendor_id"),
	workOrderId: text("work_order_id"),
	extractedText: text("extracted_text"),
}, (table) => [
	foreignKey({
			columns: [table.building],
			foreignColumns: [buildings.num],
			name: "documents_building_buildings_num_fk"
		}),
	foreignKey({
			columns: [table.unit],
			foreignColumns: [units.id],
			name: "documents_unit_units_id_fk"
		}),
]);

export const profileAudit = pgTable("profile_audit", {
	id: serial().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	unitId: text("unit_id"),
	action: text().notNull(),
	field: text().notNull(),
	oldValue: text("old_value"),
	newValue: text("new_value"),
	createdAt: text("created_at").notNull(),
});

export const buildings = pgTable("buildings", {
	num: integer().primaryKey().notNull(),
	x: integer().notNull(),
	y: integer().notNull(),
	w: integer().notNull(),
	h: integer().notNull(),
	status: text().notNull(),
	openWo: integer("open_wo").default(0).notNull(),
	address: text().notNull(),
	street: text().notNull(),
	units: integer().notNull(),
	yearBuilt: integer("year_built").notNull(),
	roofYear: integer("roof_year").notNull(),
	insuranceStatus: text("insurance_status").notNull(),
	notes: text(),
	driveFolderId: text("drive_folder_id"),
	driveSharedFolderId: text("drive_shared_folder_id"),
	driveSubfolderIds: jsonb("drive_subfolder_ids"),
});

export const units = pgTable("units", {
	id: text().primaryKey().notNull(),
	building: integer().notNull(),
	unit: text().notNull(),
	address: text().notNull(),
	beds: integer().notNull(),
	baths: doublePrecision().notNull(),
	sqft: integer().notNull(),
	occupancy: text().notNull(),
	ownerName: text("owner_name").notNull(),
	ownerPhone: text("owner_phone"),
	ownerEmail: text("owner_email"),
	tenantName: text("tenant_name"),
	tenantPhone: text("tenant_phone"),
	tenantEmail: text("tenant_email"),
	driveFolderId: text("drive_folder_id"),
	driveSubfolderIds: jsonb("drive_subfolder_ids"),
	ownerMailingAddress: text("owner_mailing_address"),
	ownerEmergencyName: text("owner_emergency_name"),
	ownerEmergencyPhone: text("owner_emergency_phone"),
	tenantEmergencyName: text("tenant_emergency_name"),
	tenantEmergencyPhone: text("tenant_emergency_phone"),
}, (table) => [
	foreignKey({
			columns: [table.building],
			foreignColumns: [buildings.num],
			name: "units_building_buildings_num_fk"
		}),
]);

export const ledgerEntries = pgTable("ledger_entries", {
	id: serial().primaryKey().notNull(),
	ownerAccountId: integer("owner_account_id").notNull(),
	occurredOn: text("occurred_on").notNull(),
	postedAt: text("posted_at").notNull(),
	kind: text().notNull(),
	chargeType: text("charge_type"),
	paymentMethod: text("payment_method"),
	amountCents: integer("amount_cents").notNull(),
	memo: text(),
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
}, (table) => [
	foreignKey({
			columns: [table.ownerAccountId],
			foreignColumns: [ownerAccounts.id],
			name: "ledger_entries_owner_account_id_owner_accounts_id_fk"
		}),
]);

export const documentCategories = pgTable("document_categories", {
	id: serial().primaryKey().notNull(),
	name: text().notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
}, (table) => [
	unique("document_categories_name_unique").on(table.name),
]);

export const mapMarkers = pgTable("map_markers", {
	id: serial().primaryKey().notNull(),
	buildingNum: integer("building_num").notNull(),
	view: text().notNull(),
	left: doublePrecision().notNull(),
	top: doublePrecision().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.buildingNum],
			foreignColumns: [buildings.num],
			name: "map_markers_building_num_buildings_num_fk"
		}),
	unique("map_markers_building_num_view_unique").on(table.buildingNum, table.view),
]);

export const userNotificationPreferences = pgTable("user_notification_preferences", {
	userId: text("user_id").primaryKey().notNull(),
	urgent: integer().default(1).notNull(),
	expiring: integer().default(1).notNull(),
	weekly: integer().default(0).notNull(),
	workOrdersInApp: integer("work_orders_in_app").default(1).notNull(),
	workOrdersEmail: integer("work_orders_email").default(1).notNull(),
	announcementsInApp: integer("announcements_in_app").default(1).notNull(),
	announcementsEmail: integer("announcements_email").default(1).notNull(),
	billingInApp: integer("billing_in_app").default(1).notNull(),
	billingEmail: integer("billing_email").default(1).notNull(),
	accInApp: integer("acc_in_app").default(1).notNull(),
	accEmail: integer("acc_email").default(1).notNull(),
});

export const workOrderAttachments = pgTable("work_order_attachments", {
	id: serial().primaryKey().notNull(),
	workOrderId: text("work_order_id").notNull(),
	storageKey: text("storage_key").notNull(),
	mimeType: text("mime_type").notNull(),
	size: integer().notNull(),
	name: text(),
	uploadedBy: integer("uploaded_by"),
	uploadedAt: text("uploaded_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workOrderId],
			foreignColumns: [workOrders.id],
			name: "work_order_attachments_work_order_id_work_orders_id_fk"
		}).onDelete("cascade"),
]);

export const bidQuoteLines = pgTable("bid_quote_lines", {
	id: serial().primaryKey().notNull(),
	bidQuoteId: integer("bid_quote_id").notNull(),
	scopeItemId: integer("scope_item_id").notNull(),
	amountCents: integer("amount_cents").default(0).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.bidQuoteId],
			foreignColumns: [bidQuotes.id],
			name: "bid_quote_lines_bid_quote_id_bid_quotes_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.scopeItemId],
			foreignColumns: [bidScopeItems.id],
			name: "bid_quote_lines_scope_item_id_bid_scope_items_id_fk"
		}).onDelete("cascade"),
	unique("bid_quote_lines_bid_quote_id_scope_item_id_unique").on(table.bidQuoteId, table.scopeItemId),
]);

export const workOrderEvents = pgTable("work_order_events", {
	id: serial().primaryKey().notNull(),
	workOrderId: text("work_order_id").notNull(),
	kind: text().notNull(),
	actorUserId: integer("actor_user_id"),
	actorName: text("actor_name"),
	payload: jsonb(),
	createdAt: text("created_at").notNull(),
	editedAt: text("edited_at"),
	deletedAt: text("deleted_at"),
	originalPayload: jsonb("original_payload"),
}, (table) => [
	foreignKey({
			columns: [table.workOrderId],
			foreignColumns: [workOrders.id],
			name: "work_order_events_work_order_id_work_orders_id_fk"
		}).onDelete("cascade"),
]);

export const bidInvitations = pgTable("bid_invitations", {
	id: serial().primaryKey().notNull(),
	bidRequestId: integer("bid_request_id").notNull(),
	vendorId: integer("vendor_id").notNull(),
	tokenHash: text("token_hash").notNull(),
	tokenExpiresAt: text("token_expires_at").notNull(),
	status: text().default('invited').notNull(),
	invitedAt: text("invited_at").notNull(),
	viewedAt: text("viewed_at"),
	submittedAt: text("submitted_at"),
	declinedAt: text("declined_at"),
	reminderSentAt: text("reminder_sent_at"),
}, (table) => [
	foreignKey({
			columns: [table.bidRequestId],
			foreignColumns: [bidRequests.id],
			name: "bid_invitations_bid_request_id_bid_requests_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.vendorId],
			foreignColumns: [vendors.id],
			name: "bid_invitations_vendor_id_vendors_id_fk"
		}),
	unique("bid_invitations_bid_request_id_vendor_id_unique").on(table.bidRequestId, table.vendorId),
	unique("bid_invitations_token_hash_unique").on(table.tokenHash),
]);

export const bidAttachments = pgTable("bid_attachments", {
	id: serial().primaryKey().notNull(),
	bidRequestId: integer("bid_request_id").notNull(),
	name: text().notNull(),
	size: integer().default(0).notNull(),
	contentType: text("content_type"),
	storageKey: text("storage_key").notNull(),
	kind: text().default('spec').notNull(),
	uploadedByUserId: integer("uploaded_by_user_id"),
	uploadedByName: text("uploaded_by_name").default(').notNull(),
	uploadedAt: text("uploaded_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.bidRequestId],
			foreignColumns: [bidRequests.id],
			name: "bid_attachments_bid_request_id_bid_requests_id_fk"
		}).onDelete("cascade"),
]);

export const users = pgTable("users", {
	id: serial().primaryKey().notNull(),
	email: text().notNull(),
	passwordHash: text("password_hash"),
	role: text().default('manager').notNull(),
	name: text().default(').notNull(),
	unitId: text("unit_id"),
	pending: boolean().default(false).notNull(),
	createdAt: text("created_at").notNull(),
	pendingEmail: text("pending_email"),
	phone: text(),
	boardMember: boolean("board_member").default(false).notNull(),
	phoneNumber: text("phone_number"),
	phoneVerified: boolean("phone_verified").default(false).notNull(),
	officerTitle: text("officer_title"),
	termStart: text("term_start"),
	termEnd: text("term_end"),
	icalFeedToken: text("ical_feed_token"),
}, (table) => [
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "users_unit_id_units_id_fk"
		}),
	unique("users_email_unique").on(table.email),
]);

export const accAttachments = pgTable("acc_attachments", {
	id: serial().primaryKey().notNull(),
	requestId: integer("request_id").notNull(),
	name: text().notNull(),
	size: integer().default(0).notNull(),
	contentType: text("content_type"),
	storageKey: text("storage_key").notNull(),
	kind: text().default('photo').notNull(),
	uploadedByUserId: integer("uploaded_by_user_id").notNull(),
	uploadedByName: text("uploaded_by_name").default(').notNull(),
	uploadedAt: text("uploaded_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.requestId],
			foreignColumns: [architecturalRequests.id],
			name: "acc_attachments_request_id_architectural_requests_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.uploadedByUserId],
			foreignColumns: [users.id],
			name: "acc_attachments_uploaded_by_user_id_users_id_fk"
		}),
]);

export const orgSettings = pgTable("org_settings", {
	id: integer().default(1).primaryKey().notNull(),
	driveRefreshToken: text("drive_refresh_token"),
	driveAccountEmail: text("drive_account_email"),
	driveConnectedAt: text("drive_connected_at"),
	driveEnabled: boolean("drive_enabled").default(false).notNull(),
	driveRootFolderId: text("drive_root_folder_id"),
	driveLastSyncAt: text("drive_last_sync_at"),
	driveLastSyncCount: integer("drive_last_sync_count"),
	driveLastSyncFailures: integer("drive_last_sync_failures").default(0).notNull(),
	driveMasterIndexFolderId: text("drive_master_index_folder_id"),
	driveSyncInProgress: boolean("drive_sync_in_progress").default(false).notNull(),
	driveSyncProgressDone: integer("drive_sync_progress_done").default(0).notNull(),
	driveSyncProgressTotal: integer("drive_sync_progress_total").default(0).notNull(),
});

export const architecturalRequests = pgTable("architectural_requests", {
	id: serial().primaryKey().notNull(),
	unitId: text("unit_id").notNull(),
	building: integer().notNull(),
	ownerUserId: integer("owner_user_id").notNull(),
	ownerName: text("owner_name").default(').notNull(),
	projectType: text("project_type").notNull(),
	title: text().notNull(),
	description: text().notNull(),
	contractorName: text("contractor_name"),
	plannedStart: text("planned_start"),
	plannedEnd: text("planned_end"),
	acknowledgedGuidelines: boolean("acknowledged_guidelines").default(false).notNull(),
	status: text().default('submitted').notNull(),
	submittedAt: text("submitted_at").notNull(),
	decidedAt: text("decided_at"),
	decisionText: text("decision_text"),
	conditionsText: text("conditions_text"),
	decisionLetterStorageKey: text("decision_letter_storage_key"),
	autoApprovalFlagged: boolean("auto_approval_flagged").default(false).notNull(),
	autoApprovalFlaggedAt: text("auto_approval_flagged_at"),
	resolutionId: integer("resolution_id"),
}, (table) => [
	foreignKey({
			columns: [table.building],
			foreignColumns: [buildings.num],
			name: "architectural_requests_building_buildings_num_fk"
		}),
	foreignKey({
			columns: [table.ownerUserId],
			foreignColumns: [users.id],
			name: "architectural_requests_owner_user_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "architectural_requests_unit_id_units_id_fk"
		}),
]);

export const accEvents = pgTable("acc_events", {
	id: serial().primaryKey().notNull(),
	requestId: integer("request_id").notNull(),
	type: text().notNull(),
	authorUserId: integer("author_user_id"),
	authorName: text("author_name").default(').notNull(),
	authorRole: text("author_role"),
	body: text(),
	fromStatus: text("from_status"),
	toStatus: text("to_status"),
	voteValue: text("vote_value"),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.authorUserId],
			foreignColumns: [users.id],
			name: "acc_events_author_user_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.requestId],
			foreignColumns: [architecturalRequests.id],
			name: "acc_events_request_id_architectural_requests_id_fk"
		}).onDelete("cascade"),
]);

export const bidQuotes = pgTable("bid_quotes", {
	id: serial().primaryKey().notNull(),
	bidRequestId: integer("bid_request_id").notNull(),
	vendorId: integer("vendor_id").notNull(),
	invitationId: integer("invitation_id"),
	leadTimeDays: integer("lead_time_days"),
	paymentTerms: text("payment_terms"),
	warrantyText: text("warranty_text"),
	notes: text(),
	licenseStorageKey: text("license_storage_key"),
	coiStorageKey: text("coi_storage_key"),
	quotePdfStorageKey: text("quote_pdf_storage_key"),
	enteredByManager: boolean("entered_by_manager").default(false).notNull(),
	firmConfirmation: boolean("firm_confirmation").default(false).notNull(),
	totalCents: integer("total_cents").default(0).notNull(),
	submittedAt: text("submitted_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.bidRequestId],
			foreignColumns: [bidRequests.id],
			name: "bid_quotes_bid_request_id_bid_requests_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.invitationId],
			foreignColumns: [bidInvitations.id],
			name: "bid_quotes_invitation_id_bid_invitations_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.vendorId],
			foreignColumns: [vendors.id],
			name: "bid_quotes_vendor_id_vendors_id_fk"
		}),
	unique("bid_quotes_bid_request_id_vendor_id_unique").on(table.bidRequestId, table.vendorId),
]);

export const bidRequests = pgTable("bid_requests", {
	id: serial().primaryKey().notNull(),
	title: text().notNull(),
	scope: text().default(').notNull(),
	buildingNum: integer("building_num"),
	unitId: text("unit_id"),
	tradeCategory: text("trade_category").notNull(),
	status: text().default('draft').notNull(),
	deadline: text().notNull(),
	sealedBids: boolean("sealed_bids").default(false).notNull(),
	sealedOpenedAt: text("sealed_opened_at"),
	notifyNonAwarded: boolean("notify_non_awarded").default(true).notNull(),
	createdBy: integer("created_by"),
	createdByName: text("created_by_name").default(').notNull(),
	createdAt: text("created_at").notNull(),
	awardedVendorId: integer("awarded_vendor_id"),
	awardedAt: text("awarded_at"),
	awardRationale: text("award_rationale"),
	awardMemoStorageKey: text("award_memo_storage_key"),
	awardedWorkOrderId: text("awarded_work_order_id"),
	sourceWorkOrderId: text("source_work_order_id"),
	awardMotionId: integer("award_motion_id"),
	awardEmergencyBypassId: integer("award_emergency_bypass_id"),
	resolutionId: integer("resolution_id"),
}, (table) => [
	foreignKey({
			columns: [table.awardedVendorId],
			foreignColumns: [vendors.id],
			name: "bid_requests_awarded_vendor_id_vendors_id_fk"
		}),
	foreignKey({
			columns: [table.awardedWorkOrderId],
			foreignColumns: [workOrders.id],
			name: "bid_requests_awarded_work_order_id_work_orders_id_fk"
		}),
	foreignKey({
			columns: [table.buildingNum],
			foreignColumns: [buildings.num],
			name: "bid_requests_building_num_buildings_num_fk"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "bid_requests_created_by_users_id_fk"
		}),
	foreignKey({
			columns: [table.sourceWorkOrderId],
			foreignColumns: [workOrders.id],
			name: "bid_requests_source_work_order_id_work_orders_id_fk"
		}),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "bid_requests_unit_id_units_id_fk"
		}),
]);

export const notificationLog = pgTable("notification_log", {
	id: serial().primaryKey().notNull(),
	recipientGroup: text("recipient_group").notNull(),
	buildingId: integer("building_id"),
	subject: text().notNull(),
	body: text().notNull(),
	sentAt: text("sent_at").notNull(),
	sentBy: text("sent_by").notNull(),
	recipientCount: integer("recipient_count").default(0).notNull(),
});

export const notifications = pgTable("notifications", {
	id: serial().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	type: text().notNull(),
	message: text().notNull(),
	entityType: text("entity_type"),
	entityId: text("entity_id"),
	read: boolean().default(false).notNull(),
	createdAt: text("created_at").notNull(),
});

export const ownerAccounts = pgTable("owner_accounts", {
	id: serial().primaryKey().notNull(),
	unitId: text("unit_id").notNull(),
	openingBalance: integer("opening_balance").default(0).notNull(),
	createdAt: text("created_at").notNull(),
	stripeCustomerId: text("stripe_customer_id"),
}, (table) => [
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "owner_accounts_unit_id_units_id_fk"
		}),
	unique("owner_accounts_unit_id_unique").on(table.unitId),
]);

export const bidScopeItems = pgTable("bid_scope_items", {
	id: serial().primaryKey().notNull(),
	bidRequestId: integer("bid_request_id").notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	label: text().notNull(),
	notes: text(),
}, (table) => [
	foreignKey({
			columns: [table.bidRequestId],
			foreignColumns: [bidRequests.id],
			name: "bid_scope_items_bid_request_id_bid_requests_id_fk"
		}).onDelete("cascade"),
]);

export const stripeEventsProcessed = pgTable("stripe_events_processed", {
	stripeEventId: text("stripe_event_id").primaryKey().notNull(),
	type: text().notNull(),
	processedAt: text("processed_at").notNull(),
});

export const ownerPaymentMethods = pgTable("owner_payment_methods", {
	id: serial().primaryKey().notNull(),
	ownerAccountId: integer("owner_account_id").notNull(),
	stripeCustomerId: text("stripe_customer_id").notNull(),
	stripePaymentMethodId: text("stripe_payment_method_id").notNull(),
	brand: text(),
	last4: text(),
	kind: text().notNull(),
	isAutoPay: boolean("is_auto_pay").default(false).notNull(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.ownerAccountId],
			foreignColumns: [ownerAccounts.id],
			name: "owner_payment_methods_owner_account_id_owner_accounts_id_fk"
		}).onDelete("cascade"),
	unique("owner_payment_methods_stripe_payment_method_id_unique").on(table.stripePaymentMethodId),
]);

export const paymentAttempts = pgTable("payment_attempts", {
	id: serial().primaryKey().notNull(),
	ledgerEntryId: integer("ledger_entry_id"),
	paidLedgerEntryId: integer("paid_ledger_entry_id"),
	ownerAccountId: integer("owner_account_id").notNull(),
	amountCents: integer("amount_cents").notNull(),
	surchargeCents: integer("surcharge_cents").default(0).notNull(),
	refundedAmountCents: integer("refunded_amount_cents").default(0).notNull(),
	kind: text().notNull(),
	status: text().notNull(),
	stripePaymentIntentId: text("stripe_payment_intent_id"),
	stripeChargeId: text("stripe_charge_id"),
	paymentMethodId: integer("payment_method_id"),
	initiatedBy: text("initiated_by").default('owner').notNull(),
	errorMessage: text("error_message"),
	disputeStatus: text("dispute_status"),
	saveMethodRequested: boolean("save_method_requested").default(false).notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.ownerAccountId],
			foreignColumns: [ownerAccounts.id],
			name: "payment_attempts_owner_account_id_owner_accounts_id_fk"
		}).onDelete("cascade"),
]);

export const stripeConfig = pgTable("stripe_config", {
	id: integer().default(1).primaryKey().notNull(),
	secretKey: text("secret_key"),
	publishableKey: text("publishable_key"),
	webhookSecret: text("webhook_secret"),
	updatedAt: text("updated_at"),
	updatedByUserId: integer("updated_by_user_id"),
	updatedByName: text("updated_by_name"),
});

export const organizationSettings = pgTable("organization_settings", {
	id: integer().default(1).primaryKey().notNull(),
	name: text().default(').notNull(),
	address: text(),
	contactEmail: text("contact_email"),
	phone: text(),
	timezone: text().default('America/Chicago').notNull(),
	notificationPreferences: jsonb("notification_preferences"),
	accEnabled: boolean("acc_enabled").default(true).notNull(),
	accQuorumMode: text("acc_quorum_mode").default('any').notNull(),
	accAutoApprovalDays: integer("acc_auto_approval_days").default(0).notNull(),
	bidMinQuotesThresholdCents: integer("bid_min_quotes_threshold_cents").default(0).notNull(),
	bidDefaultSealed: boolean("bid_default_sealed").default(false).notNull(),
	bidReminderDaysBefore: integer("bid_reminder_days_before").default(3).notNull(),
	paymentsEnabled: boolean("payments_enabled").default(false).notNull(),
	paymentsSurchargeEnabled: boolean("payments_surcharge_enabled").default(false).notNull(),
	paymentsSurchargePercentBp: integer("payments_surcharge_percent_bp").default(0).notNull(),
	paymentsAutoPayLagDays: integer("payments_auto_pay_lag_days").default(3).notNull(),
	expenditureThresholdCents: integer("expenditure_threshold_cents").default(0).notNull(),
	gatedPolicies: jsonb("gated_policies").default([]).notNull(),
	emergencyBypassEnabled: boolean("emergency_bypass_enabled").default(false).notNull(),
	meetingNoticeOpenDays: integer("meeting_notice_open_days").default(3).notNull(),
	meetingNoticeExecutiveDays: integer("meeting_notice_executive_days").default(2).notNull(),
	meetingNoticeAnnualDays: integer("meeting_notice_annual_days").default(30).notNull(),
	meetingQuorumMode: text("meeting_quorum_mode").default('majority').notNull(),
	meetingQuorumPercentBp: integer("meeting_quorum_percent_bp").default(5000).notNull(),
	ocrEnabled: boolean("ocr_enabled").default(true).notNull(),
	ocrDailyPageCap: integer("ocr_daily_page_cap").default(1000).notNull(),
});

export const boardMemberAudit = pgTable("board_member_audit", {
	id: serial().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	oldValue: boolean("old_value").notNull(),
	newValue: boolean("new_value").notNull(),
	changedByUserId: integer("changed_by_user_id"),
	changedByName: text("changed_by_name").default(').notNull(),
	changedByEmail: text("changed_by_email").default(').notNull(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.changedByUserId],
			foreignColumns: [users.id],
			name: "board_member_audit_changed_by_user_id_users_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "board_member_audit_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const amenityInspectionTemplates = pgTable("amenity_inspection_templates", {
	id: serial().primaryKey().notNull(),
	amenitySlug: text("amenity_slug"),
	name: text().notNull(),
	kind: text().notNull(),
	description: text().default(').notNull(),
	enabled: boolean().default(true).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
});

export const workOrders = pgTable("work_orders", {
	id: text().primaryKey().notNull(),
	building: integer().notNull(),
	unit: text(),
	title: text().notNull(),
	category: text().notNull(),
	priority: text().notNull(),
	status: text().notNull(),
	vendor: text(),
	opened: text().notNull(),
	due: text(),
	estCost: integer("est_cost").default(0).notNull(),
	description: text(),
	vendorId: integer("vendor_id"),
	sourceBidId: integer("source_bid_id"),
	sourceMotionId: integer("source_motion_id"),
	emergencyBypassId: integer("emergency_bypass_id"),
	resolutionId: integer("resolution_id"),
	historical: boolean().default(false).notNull(),
	completedOn: text("completed_on"),
	actualCost: integer("actual_cost"),
	historicalVendorName: text("historical_vendor_name"),
	historicalNotes: text("historical_notes"),
}, (table) => [
	foreignKey({
			columns: [table.building],
			foreignColumns: [buildings.num],
			name: "work_orders_building_buildings_num_fk"
		}),
	foreignKey({
			columns: [table.unit],
			foreignColumns: [units.id],
			name: "work_orders_unit_units_id_fk"
		}),
	foreignKey({
			columns: [table.vendorId],
			foreignColumns: [vendors.id],
			name: "work_orders_vendor_id_vendors_id_fk"
		}),
]);

export const amenityInspectionTemplateItems = pgTable("amenity_inspection_template_items", {
	id: serial().primaryKey().notNull(),
	templateId: integer("template_id").notNull(),
	label: text().notNull(),
	helpText: text("help_text").default(').notNull(),
	requiresPhoto: boolean("requires_photo").default(false).notNull(),
	severity: text().default('warn').notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.templateId],
			foreignColumns: [amenityInspectionTemplates.id],
			name: "amenity_inspection_template_items_template_id_amenity_inspectio"
		}).onDelete("cascade"),
]);

export const amenityInspections = pgTable("amenity_inspections", {
	id: serial().primaryKey().notNull(),
	bookingId: integer("booking_id").notNull(),
	templateId: integer("template_id"),
	kind: text().notNull(),
	status: text().default('draft').notNull(),
	inspectorUserId: integer("inspector_user_id"),
	inspectorName: text("inspector_name").default(').notNull(),
	inspectorRole: text("inspector_role").default(').notNull(),
	notes: text().default(').notNull(),
	signature: text().default(').notNull(),
	performedAt: text("performed_at"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.bookingId],
			foreignColumns: [amenityBookings.id],
			name: "amenity_inspections_booking_id_amenity_bookings_id_fk"
		}).onDelete("cascade"),
]);

export const amenityInspectionItemResults = pgTable("amenity_inspection_item_results", {
	id: serial().primaryKey().notNull(),
	inspectionId: integer("inspection_id").notNull(),
	templateItemId: integer("template_item_id"),
	label: text().notNull(),
	status: text().default('ok').notNull(),
	note: text().default(').notNull(),
	photoStorageKey: text("photo_storage_key"),
	sortOrder: integer("sort_order").default(0).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.inspectionId],
			foreignColumns: [amenityInspections.id],
			name: "amenity_inspection_item_results_inspection_id_amenity_inspectio"
		}).onDelete("cascade"),
]);

export const amenityDamageReports = pgTable("amenity_damage_reports", {
	id: serial().primaryKey().notNull(),
	bookingId: integer("booking_id").notNull(),
	inspectionId: integer("inspection_id"),
	reportedByUserId: integer("reported_by_user_id"),
	reportedByName: text("reported_by_name").default(').notNull(),
	summary: text().default(').notNull(),
	details: text().default(').notNull(),
	estimatedCostCents: integer("estimated_cost_cents").default(0).notNull(),
	depositChargedCents: integer("deposit_charged_cents").default(0).notNull(),
	photoStorageKeys: jsonb("photo_storage_keys").default([]).notNull(),
	status: text().default('open').notNull(),
	workOrderId: text("work_order_id"),
	managerNotes: text("manager_notes").default(').notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
	resolvedAt: text("resolved_at"),
}, (table) => [
	foreignKey({
			columns: [table.bookingId],
			foreignColumns: [amenityBookings.id],
			name: "amenity_damage_reports_booking_id_amenity_bookings_id_fk"
		}).onDelete("cascade"),
]);

export const amenityDamageDisputes = pgTable("amenity_damage_disputes", {
	id: serial().primaryKey().notNull(),
	damageReportId: integer("damage_report_id").notNull(),
	ownerUserId: integer("owner_user_id").notNull(),
	ownerName: text("owner_name").default(').notNull(),
	message: text().default(').notNull(),
	evidenceStorageKeys: jsonb("evidence_storage_keys").default([]).notNull(),
	status: text().default('open').notNull(),
	managerResponse: text("manager_response").default(').notNull(),
	resolvedByUserId: integer("resolved_by_user_id"),
	resolvedAt: text("resolved_at"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.damageReportId],
			foreignColumns: [amenityDamageReports.id],
			name: "amenity_damage_disputes_damage_report_id_amenity_damage_reports"
		}).onDelete("cascade"),
]);

export const poolChemistryLogs = pgTable("pool_chemistry_logs", {
	id: serial().primaryKey().notNull(),
	recordedAt: text("recorded_at").notNull(),
	recordedByUserId: integer("recorded_by_user_id"),
	recordedByName: text("recorded_by_name").default(').notNull(),
	freeChlorinePpm: doublePrecision("free_chlorine_ppm"),
	totalChlorinePpm: doublePrecision("total_chlorine_ppm"),
	ph: doublePrecision(),
	alkalinityPpm: doublePrecision("alkalinity_ppm"),
	calciumHardnessPpm: doublePrecision("calcium_hardness_ppm"),
	cyanuricAcidPpm: doublePrecision("cyanuric_acid_ppm"),
	temperatureF: doublePrecision("temperature_f"),
	notes: text().default(').notNull(),
	flagged: boolean().default(false).notNull(),
	flagReasons: jsonb("flag_reasons").default([]).notNull(),
	workOrderId: text("work_order_id"),
	createdAt: text("created_at").notNull(),
});

export const amenityDepositLedger = pgTable("amenity_deposit_ledger", {
	id: serial().primaryKey().notNull(),
	bookingId: integer("booking_id").notNull(),
	kind: text().notNull(),
	amountCents: integer("amount_cents").default(0).notNull(),
	balanceCents: integer("balance_cents").default(0).notNull(),
	reason: text().default(').notNull(),
	damageReportId: integer("damage_report_id"),
	actorUserId: integer("actor_user_id"),
	actorName: text("actor_name").default(').notNull(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.bookingId],
			foreignColumns: [amenityBookings.id],
			name: "amenity_deposit_ledger_booking_id_amenity_bookings_id_fk"
		}).onDelete("cascade"),
]);

export const amenityAccessAudit = pgTable("amenity_access_audit", {
	id: serial().primaryKey().notNull(),
	bookingId: integer("booking_id"),
	amenityId: integer("amenity_id"),
	accessCodeId: integer("access_code_id"),
	providerKind: text("provider_kind").default('none').notNull(),
	action: text().notNull(),
	success: boolean().default(true).notNull(),
	actorUserId: integer("actor_user_id"),
	actorName: text("actor_name").default(').notNull(),
	message: text().default(').notNull(),
	payload: jsonb(),
	createdAt: text("created_at").notNull(),
});

export const amenities = pgTable("amenities", {
	id: serial().primaryKey().notNull(),
	slug: text().notNull(),
	name: text().notNull(),
	description: text().default(').notNull(),
	photoUrl: text("photo_url"),
	capacity: integer().default(0).notNull(),
	bookingUnit: text("booking_unit").default('hourly').notNull(),
	depositCents: integer("deposit_cents").default(0).notNull(),
	rules: jsonb().default({}).notNull(),
	agreementText: text("agreement_text").default(').notNull(),
	agreementTemplatePath: text("agreement_template_path"),
	enabled: boolean().default(true).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	unique("amenities_slug_unique").on(table.slug),
]);

export const amenityAnnualInspections = pgTable("amenity_annual_inspections", {
	id: serial().primaryKey().notNull(),
	amenityId: integer("amenity_id").notNull(),
	year: integer().notNull(),
	scheduledOn: text("scheduled_on").notNull(),
	performedOn: text("performed_on"),
	inspectorName: text("inspector_name").default(').notNull(),
	inspectorAgency: text("inspector_agency").default(').notNull(),
	inspectorUserId: integer("inspector_user_id"),
	status: text().default('scheduled').notNull(),
	checklist: jsonb().default([]).notNull(),
	reportStorageKey: text("report_storage_key"),
	notes: text().default(').notNull(),
	workOrderIds: jsonb("work_order_ids").default([]).notNull(),
	calendarEventId: integer("calendar_event_id"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.amenityId],
			foreignColumns: [amenities.id],
			name: "amenity_annual_inspections_amenity_id_amenities_id_fk"
		}).onDelete("cascade"),
]);

export const amenityBlackouts = pgTable("amenity_blackouts", {
	id: serial().primaryKey().notNull(),
	amenityId: integer("amenity_id").notNull(),
	startsAt: text("starts_at").notNull(),
	endsAt: text("ends_at").notNull(),
	reason: text().default(').notNull(),
	createdByUserId: integer("created_by_user_id"),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.amenityId],
			foreignColumns: [amenities.id],
			name: "amenity_blackouts_amenity_id_amenities_id_fk"
		}).onDelete("cascade"),
]);

export const amenityBookingAudit = pgTable("amenity_booking_audit", {
	id: serial().primaryKey().notNull(),
	bookingId: integer("booking_id").notNull(),
	action: text().notNull(),
	actorUserId: integer("actor_user_id"),
	actorName: text("actor_name").default(').notNull(),
	diff: jsonb(),
	createdAt: text("created_at").notNull(),
});

export const amenityAccessProviders = pgTable("amenity_access_providers", {
	id: serial().primaryKey().notNull(),
	amenityId: integer("amenity_id").notNull(),
	kind: text().default('none').notNull(),
	baseUrlEnvVar: text("base_url_env_var"),
	apiKeyEnvVar: text("api_key_env_var"),
	config: jsonb().default({}).notNull(),
	enabled: boolean().default(true).notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.amenityId],
			foreignColumns: [amenities.id],
			name: "amenity_access_providers_amenity_id_amenities_id_fk"
		}).onDelete("cascade"),
	unique("amenity_access_providers_amenity_id_unique").on(table.amenityId),
]);

export const amenityBookings = pgTable("amenity_bookings", {
	id: serial().primaryKey().notNull(),
	amenityId: integer("amenity_id").notNull(),
	ownerUserId: integer("owner_user_id").notNull(),
	unitId: text("unit_id"),
	startsAt: text("starts_at").notNull(),
	endsAt: text("ends_at").notNull(),
	guestCount: integer("guest_count").default(0).notNull(),
	purpose: text().default(').notNull(),
	status: text().default('pending_payment').notNull(),
	depositCents: integer("deposit_cents").default(0).notNull(),
	depositPaidAt: text("deposit_paid_at"),
	depositRefundedAt: text("deposit_refunded_at"),
	agreementSigned: boolean("agreement_signed").default(false).notNull(),
	agreementSignedAt: text("agreement_signed_at"),
	agreementSignedIp: text("agreement_signed_ip"),
	agreementSignedName: text("agreement_signed_name").default(').notNull(),
	agreementText: text("agreement_text").default(').notNull(),
	lifeguardRequested: boolean("lifeguard_requested").default(false).notNull(),
	permitNumber: text("permit_number"),
	calendarEventId: integer("calendar_event_id"),
	managerNotes: text("manager_notes").default(').notNull(),
	cancelledAt: text("cancelled_at"),
	cancelledByUserId: integer("cancelled_by_user_id"),
	cancellationReason: text("cancellation_reason").default(').notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.amenityId],
			foreignColumns: [amenities.id],
			name: "amenity_bookings_amenity_id_amenities_id_fk"
		}).onDelete("restrict"),
]);

export const amenityExpenseEntries = pgTable("amenity_expense_entries", {
	id: serial().primaryKey().notNull(),
	amenityId: integer("amenity_id").notNull(),
	occurredOn: text("occurred_on").notNull(),
	kind: text().default('other').notNull(),
	vendor: text().default(').notNull(),
	vendorId: integer("vendor_id"),
	description: text().default(').notNull(),
	amountCents: integer("amount_cents").default(0).notNull(),
	invoiceRef: text("invoice_ref").default(').notNull(),
	workOrderId: text("work_order_id"),
	notes: text().default(').notNull(),
	createdByUserId: integer("created_by_user_id"),
	createdByName: text("created_by_name").default(').notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.amenityId],
			foreignColumns: [amenities.id],
			name: "amenity_expense_entries_amenity_id_amenities_id_fk"
		}).onDelete("restrict"),
]);

export const amenityIncidentReports = pgTable("amenity_incident_reports", {
	id: serial().primaryKey().notNull(),
	amenityId: integer("amenity_id").notNull(),
	bookingId: integer("booking_id"),
	occurredAt: text("occurred_at").notNull(),
	reportedAt: text("reported_at").notNull(),
	reportedByUserId: integer("reported_by_user_id"),
	reportedByName: text("reported_by_name").default(').notNull(),
	reportedByRole: text("reported_by_role").default(').notNull(),
	kind: text().notNull(),
	severity: text().default('minor').notNull(),
	involvedParties: text("involved_parties").default(').notNull(),
	witnesses: text().default(').notNull(),
	emsCalled: boolean("ems_called").default(false).notNull(),
	policeCalled: boolean("police_called").default(false).notNull(),
	insuranceNotified: boolean("insurance_notified").default(false).notNull(),
	insuranceClaimNumber: text("insurance_claim_number").default(').notNull(),
	narrative: text().default(').notNull(),
	immediateActions: text("immediate_actions").default(').notNull(),
	followUpActions: text("follow_up_actions").default(').notNull(),
	followUpDueOn: text("follow_up_due_on"),
	status: text().default('open').notNull(),
	closedAt: text("closed_at"),
	closedByUserId: integer("closed_by_user_id"),
	workOrderIds: jsonb("work_order_ids").default([]).notNull(),
	ownerVisible: boolean("owner_visible").default(false).notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.amenityId],
			foreignColumns: [amenities.id],
			name: "amenity_incident_reports_amenity_id_amenities_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.bookingId],
			foreignColumns: [amenityBookings.id],
			name: "amenity_incident_reports_booking_id_amenity_bookings_id_fk"
		}).onDelete("set null"),
]);

export const amenityIncidentAudit = pgTable("amenity_incident_audit", {
	id: serial().primaryKey().notNull(),
	incidentId: integer("incident_id").notNull(),
	action: text().notNull(),
	actorUserId: integer("actor_user_id"),
	actorName: text("actor_name").default(').notNull(),
	diff: jsonb(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.incidentId],
			foreignColumns: [amenityIncidentReports.id],
			name: "amenity_incident_audit_incident_id_amenity_incident_reports_id_"
		}).onDelete("cascade"),
]);

export const amenityLifeguardWindows = pgTable("amenity_lifeguard_windows", {
	id: serial().primaryKey().notNull(),
	amenityId: integer("amenity_id").notNull(),
	startsAt: text("starts_at").notNull(),
	endsAt: text("ends_at").notNull(),
	staffName: text("staff_name").default(').notNull(),
	createdByUserId: integer("created_by_user_id"),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.amenityId],
			foreignColumns: [amenities.id],
			name: "amenity_lifeguard_windows_amenity_id_amenities_id_fk"
		}).onDelete("cascade"),
]);

export const amenityRequiredPostings = pgTable("amenity_required_postings", {
	id: serial().primaryKey().notNull(),
	amenityId: integer("amenity_id").notNull(),
	kind: text().notNull(),
	title: text().notNull(),
	description: text().default(').notNull(),
	templateBody: text("template_body").default(').notNull(),
	replaceEveryDays: integer("replace_every_days").default(0).notNull(),
	required: boolean().default(true).notNull(),
	citation: text().default(').notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.amenityId],
			foreignColumns: [amenities.id],
			name: "amenity_required_postings_amenity_id_amenities_id_fk"
		}).onDelete("cascade"),
]);

export const amenityPostingIssuances = pgTable("amenity_posting_issuances", {
	id: serial().primaryKey().notNull(),
	postingId: integer("posting_id").notNull(),
	amenityId: integer("amenity_id").notNull(),
	renderedBody: text("rendered_body").default(').notNull(),
	documentStorageKey: text("document_storage_key"),
	postedAt: text("posted_at").notNull(),
	postedByUserId: integer("posted_by_user_id"),
	postedByName: text("posted_by_name").default(').notNull(),
	expiresAt: text("expires_at"),
	status: text().default('active').notNull(),
	removedAt: text("removed_at"),
	removedReason: text("removed_reason").default(').notNull(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.amenityId],
			foreignColumns: [amenities.id],
			name: "amenity_posting_issuances_amenity_id_amenities_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.postingId],
			foreignColumns: [amenityRequiredPostings.id],
			name: "amenity_posting_issuances_posting_id_amenity_required_postings_"
		}).onDelete("cascade"),
]);

export const amenityCertificates = pgTable("amenity_certificates", {
	id: serial().primaryKey().notNull(),
	amenityId: integer("amenity_id").notNull(),
	kind: text().notNull(),
	title: text().notNull(),
	issuer: text().default(').notNull(),
	identifier: text().default(').notNull(),
	vendorId: integer("vendor_id"),
	effectiveOn: text("effective_on"),
	expiresOn: text("expires_on"),
	documentStorageKey: text("document_storage_key"),
	notes: text().default(').notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.amenityId],
			foreignColumns: [amenities.id],
			name: "amenity_certificates_amenity_id_amenities_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.vendorId],
			foreignColumns: [vendors.id],
			name: "amenity_certificates_vendor_id_vendors_id_fk"
		}).onDelete("set null"),
]);

export const amenityEmergencyProcedures = pgTable("amenity_emergency_procedures", {
	id: serial().primaryKey().notNull(),
	amenityId: integer("amenity_id").notNull(),
	emergencyContact: text("emergency_contact").default('911').notNull(),
	managerOnCallName: text("manager_on_call_name").default(').notNull(),
	managerOnCallPhone: text("manager_on_call_phone").default(').notNull(),
	evacuationRoute: text("evacuation_route").default(').notNull(),
	shelterLocation: text("shelter_location").default(').notNull(),
	hazardNotes: text("hazard_notes").default(').notNull(),
	steps: jsonb().default([]).notNull(),
	postedStorageKey: text("posted_storage_key"),
	updatedAt: text("updated_at").notNull(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.amenityId],
			foreignColumns: [amenities.id],
			name: "amenity_emergency_procedures_amenity_id_amenities_id_fk"
		}).onDelete("cascade"),
	unique("amenity_emergency_procedures_amenity_id_unique").on(table.amenityId),
]);

export const assessmentSchedules = pgTable("assessment_schedules", {
	id: serial().primaryKey().notNull(),
	name: text().notNull(),
	frequency: text().notNull(),
	amountCents: integer("amount_cents").notNull(),
	dueDay: integer("due_day").default(1).notNull(),
	startDate: text("start_date").notNull(),
	endDate: text("end_date"),
	active: boolean().default(true).notNull(),
	reminderLeadsMinutes: jsonb("reminder_leads_minutes").default([10080,1440]).notNull(),
	notes: text().default(').notNull(),
	calendarEventId: integer("calendar_event_id"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
});

export const boardHistory = pgTable("board_history", {
	id: serial().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	actorUserId: integer("actor_user_id"),
	actorName: text("actor_name").default(').notNull(),
	action: text().notNull(),
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

export const buildingSystemDocuments = pgTable("building_system_documents", {
	id: serial().primaryKey().notNull(),
	systemId: integer("system_id").notNull(),
	documentId: text("document_id").notNull(),
	kind: text().default('other').notNull(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.systemId],
			foreignColumns: [buildingSystems.id],
			name: "building_system_documents_system_id_building_systems_id_fk"
		}).onDelete("cascade"),
]);

export const budgetCycles = pgTable("budget_cycles", {
	id: serial().primaryKey().notNull(),
	fiscalYear: integer("fiscal_year").notNull(),
	draftDueDate: text("draft_due_date"),
	reviewMeetingDate: text("review_meeting_date"),
	ratificationMeetingDate: text("ratification_meeting_date"),
	publicationDate: text("publication_date"),
	reserveStudyRefreshDate: text("reserve_study_refresh_date"),
	notes: text().default(').notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	unique("budget_cycles_fiscal_year_unique").on(table.fiscalYear),
]);

export const buildingSystemInspections = pgTable("building_system_inspections", {
	id: serial().primaryKey().notNull(),
	systemId: integer("system_id").notNull(),
	inspectedOn: text("inspected_on").notNull(),
	inspector: text(),
	summary: text(),
	documentId: text("document_id"),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.systemId],
			foreignColumns: [buildingSystems.id],
			name: "building_system_inspections_system_id_building_systems_id_fk"
		}).onDelete("cascade"),
]);

export const buildingSystemRepairs = pgTable("building_system_repairs", {
	id: serial().primaryKey().notNull(),
	systemId: integer("system_id").notNull(),
	workOrderId: text("work_order_id").notNull(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.systemId],
			foreignColumns: [buildingSystems.id],
			name: "building_system_repairs_system_id_building_systems_id_fk"
		}).onDelete("cascade"),
	unique("building_system_repairs_system_id_work_order_id_unique").on(table.systemId, table.workOrderId),
]);

export const amenitySafetyPins = pgTable("amenity_safety_pins", {
	id: serial().primaryKey().notNull(),
	amenityId: integer("amenity_id").notNull(),
	kind: text().notNull(),
	label: text().notNull(),
	locationDescription: text("location_description").default(').notNull(),
	posX: doublePrecision("pos_x"),
	posY: doublePrecision("pos_y"),
	lastCheckedOn: text("last_checked_on"),
	lastCheckedByName: text("last_checked_by_name").default(').notNull(),
	serviceDueOn: text("service_due_on"),
	notes: text().default(').notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.amenityId],
			foreignColumns: [amenities.id],
			name: "amenity_safety_pins_amenity_id_amenities_id_fk"
		}).onDelete("cascade"),
]);

export const bookingGuestPasses = pgTable("booking_guest_passes", {
	id: serial().primaryKey().notNull(),
	bookingId: integer("booking_id").notNull(),
	name: text().notNull(),
	plate: text().default(').notNull(),
	vehicleDesc: text("vehicle_desc").default(').notNull(),
	checkedInAt: text("checked_in_at"),
	notes: text().default(').notNull(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.bookingId],
			foreignColumns: [amenityBookings.id],
			name: "booking_guest_passes_booking_id_amenity_bookings_id_fk"
		}).onDelete("cascade"),
]);

export const calendarEventReminders = pgTable("calendar_event_reminders", {
	id: serial().primaryKey().notNull(),
	eventId: integer("event_id").notNull(),
	instanceStartsAt: text("instance_starts_at").notNull(),
	leadMinutes: integer("lead_minutes").notNull(),
	channelInApp: boolean("channel_in_app").default(true).notNull(),
	channelEmail: boolean("channel_email").default(true).notNull(),
	channelSms: boolean("channel_sms").default(false).notNull(),
	userId: integer("user_id"),
	dispatchedAt: text("dispatched_at"),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [calendarEvents.id],
			name: "calendar_event_reminders_event_id_calendar_events_id_fk"
		}).onDelete("cascade"),
]);

export const calendarEventAudit = pgTable("calendar_event_audit", {
	id: serial().primaryKey().notNull(),
	eventId: integer("event_id").notNull(),
	action: text().notNull(),
	actorUserId: integer("actor_user_id"),
	actorName: text("actor_name").default(').notNull(),
	diff: jsonb(),
	createdAt: text("created_at").notNull(),
});

export const calendarEventRsvps = pgTable("calendar_event_rsvps", {
	id: serial().primaryKey().notNull(),
	eventId: integer("event_id").notNull(),
	occurrenceKey: text("occurrence_key").default(').notNull(),
	userId: integer("user_id").notNull(),
	userName: text("user_name").default(').notNull(),
	status: text().notNull(),
	partySize: integer("party_size").default(1).notNull(),
	waitlistPosition: integer("waitlist_position"),
	unitId: text("unit_id"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [calendarEvents.id],
			name: "calendar_event_rsvps_event_id_calendar_events_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "calendar_event_rsvps_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("calendar_event_rsvps_event_id_occurrence_key_user_id_unique").on(table.eventId, table.occurrenceKey, table.userId),
]);

export const calendarResources = pgTable("calendar_resources", {
	id: serial().primaryKey().notNull(),
	name: text().notNull(),
	description: text().default(').notNull(),
	capacity: integer(),
	active: boolean().default(true).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	unique("calendar_resources_name_unique").on(table.name),
]);

export const calendarExternalFeeds = pgTable("calendar_external_feeds", {
	id: serial().primaryKey().notNull(),
	subCalendarId: integer("sub_calendar_id").notNull(),
	name: text().notNull(),
	url: text().notNull(),
	enabled: boolean().default(true).notNull(),
	lastFetchedAt: text("last_fetched_at"),
	lastError: text("last_error"),
	lastEventCount: integer("last_event_count").default(0).notNull(),
	createdByUserId: integer("created_by_user_id"),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.subCalendarId],
			foreignColumns: [calendarSubCalendars.id],
			name: "calendar_external_feeds_sub_calendar_id_calendar_sub_calendars_"
		}).onDelete("cascade"),
]);

export const calendarShareTokens = pgTable("calendar_share_tokens", {
	id: serial().primaryKey().notNull(),
	token: text().notNull(),
	label: text().default('Community share link').notNull(),
	subCalendarSlugs: jsonb("sub_calendar_slugs").default([]).notNull(),
	createdByUserId: integer("created_by_user_id"),
	createdAt: text("created_at").notNull(),
	revokedAt: text("revoked_at"),
}, (table) => [
	unique("calendar_share_tokens_token_unique").on(table.token),
]);

export const buildingSystems = pgTable("building_systems", {
	id: serial().primaryKey().notNull(),
	building: integer().notNull(),
	kind: text().notNull(),
	label: text().notNull(),
	installedOn: text("installed_on"),
	warrantyExpiresOn: text("warranty_expires_on"),
	manufacturer: text(),
	model: text(),
	serialNo: text("serial_no"),
	status: text().default('good').notNull(),
	retiredOn: text("retired_on"),
	notes: text(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.building],
			foreignColumns: [buildings.num],
			name: "building_systems_building_buildings_num_fk"
		}),
]);

export const calendarEvents = pgTable("calendar_events", {
	id: serial().primaryKey().notNull(),
	subCalendarId: integer("sub_calendar_id").notNull(),
	title: text().notNull(),
	body: text().default(').notNull(),
	startsAt: text("starts_at").notNull(),
	endsAt: text("ends_at").notNull(),
	allDay: boolean("all_day").default(false).notNull(),
	locationText: text("location_text"),
	locationUrl: text("location_url"),
	resourceId: integer("resource_id"),
	capacity: integer(),
	perUnitCap: integer("per_unit_cap"),
	recurrence: jsonb(),
	exceptions: jsonb().default([]).notNull(),
	overrides: jsonb().default([]).notNull(),
	source: text(),
	sourceRefType: text("source_ref_type"),
	sourceRefId: text("source_ref_id"),
	externalUid: text("external_uid"),
	ownerUserId: integer("owner_user_id"),
	cancelled: boolean().default(false).notNull(),
	createdByUserId: integer("created_by_user_id"),
	createdByName: text("created_by_name").default(').notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.resourceId],
			foreignColumns: [calendarResources.id],
			name: "calendar_events_resource_id_calendar_resources_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.subCalendarId],
			foreignColumns: [calendarSubCalendars.id],
			name: "calendar_events_sub_calendar_id_calendar_sub_calendars_id_fk"
		}).onDelete("restrict"),
]);

export const calendarUserPrefs = pgTable("calendar_user_prefs", {
	userId: integer("user_id").primaryKey().notNull(),
	visibleSubCalendars: jsonb("visible_sub_calendars").default({}).notNull(),
	defaultView: text("default_view").default('month').notNull(),
	icalToken: text("ical_token"),
	icalTokenCreatedAt: text("ical_token_created_at"),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "calendar_user_prefs_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("calendar_user_prefs_ical_token_unique").on(table.icalToken),
]);

export const chargingSessions = pgTable("charging_sessions", {
	id: serial().primaryKey().notNull(),
	portId: integer("port_id").notNull(),
	reservationId: integer("reservation_id"),
	ownerUserId: integer("owner_user_id").notNull(),
	unitId: text("unit_id"),
	startAt: text("start_at").notNull(),
	endAt: text("end_at"),
	scheduledEndAt: text("scheduled_end_at"),
	kwh: numeric({ precision: 12, scale:  4 }).default('0').notNull(),
	meterStartKwh: numeric("meter_start_kwh", { precision: 12, scale:  4 }),
	meterEndKwh: numeric("meter_end_kwh", { precision: 12, scale:  4 }),
	energyCostCents: integer("energy_cost_cents").default(0).notNull(),
	idleMinutes: integer("idle_minutes").default(0).notNull(),
	idleCostCents: integer("idle_cost_cents").default(0).notNull(),
	costCents: integer("cost_cents").default(0).notNull(),
	status: text().default('active').notNull(),
	providerSessionRef: text("provider_session_ref"),
	ledgerEntryId: integer("ledger_entry_id"),
	refundLedgerEntryId: integer("refund_ledger_entry_id"),
	refundReason: text("refund_reason"),
	lastPolledAt: text("last_polled_at"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.portId],
			foreignColumns: [chargingPorts.id],
			name: "charging_sessions_port_id_charging_ports_id_fk"
		}).onDelete("restrict"),
]);

export const chargingPorts = pgTable("charging_ports", {
	id: serial().primaryKey().notNull(),
	amenityId: integer("amenity_id").notNull(),
	name: text().notNull(),
	location: text().default(').notNull(),
	connectorType: text("connector_type").default('J1772').notNull(),
	maxKw: integer("max_kw").default(7).notNull(),
	mode: text().default('reserved').notNull(),
	provider: text().default('manual').notNull(),
	providerConfig: jsonb("provider_config").default({}).notNull(),
	perKwhCents: integer("per_kwh_cents").default(35).notNull(),
	idlePerMinuteCents: integer("idle_per_minute_cents").default(40).notNull(),
	idleGraceMinutes: integer("idle_grace_minutes").default(10).notNull(),
	idleCapCents: integer("idle_cap_cents").default(2000).notNull(),
	noShowFeeCents: integer("no_show_fee_cents").default(0).notNull(),
	noShowGraceMinutes: integer("no_show_grace_minutes").default(15).notNull(),
	enabled: boolean().default(true).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.amenityId],
			foreignColumns: [amenities.id],
			name: "charging_ports_amenity_id_amenities_id_fk"
		}).onDelete("cascade"),
]);

export const chargingReservations = pgTable("charging_reservations", {
	id: serial().primaryKey().notNull(),
	portId: integer("port_id").notNull(),
	ownerUserId: integer("owner_user_id").notNull(),
	unitId: text("unit_id"),
	startsAt: text("starts_at").notNull(),
	endsAt: text("ends_at").notNull(),
	status: text().default('pending').notNull(),
	sessionId: integer("session_id"),
	noShowFeeLedgerEntryId: integer("no_show_fee_ledger_entry_id"),
	cancelledAt: text("cancelled_at"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.portId],
			foreignColumns: [chargingPorts.id],
			name: "charging_reservations_port_id_charging_ports_id_fk"
		}).onDelete("cascade"),
]);

export const chargingSessionUsageSamples = pgTable("charging_session_usage_samples", {
	id: serial().primaryKey().notNull(),
	sessionId: integer("session_id").notNull(),
	sampledAt: text("sampled_at").notNull(),
	kwh: numeric({ precision: 12, scale:  4 }).notNull(),
	powerKw: numeric("power_kw", { precision: 10, scale:  3 }),
}, (table) => [
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [chargingSessions.id],
			name: "charging_session_usage_samples_session_id_charging_sessions_id_"
		}).onDelete("cascade"),
]);

export const chargingSessionAudit = pgTable("charging_session_audit", {
	id: serial().primaryKey().notNull(),
	sessionId: integer("session_id").notNull(),
	action: text().notNull(),
	actorUserId: integer("actor_user_id"),
	actorName: text("actor_name").default(').notNull(),
	diff: jsonb(),
	createdAt: text("created_at").notNull(),
});

export const calendarSubCalendars = pgTable("calendar_sub_calendars", {
	id: serial().primaryKey().notNull(),
	slug: text().notNull(),
	name: text().notNull(),
	color: text().default('#3245FF').notNull(),
	description: text().default(').notNull(),
	editorRoles: jsonb("editor_roles").notNull(),
	viewerRoles: jsonb("viewer_roles").default([]).notNull(),
	isPublic: boolean("is_public").default(false).notNull(),
	isExternal: boolean("is_external").default(false).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
}, (table) => [
	unique("calendar_sub_calendars_slug_unique").on(table.slug),
]);

export const collectionsPolicies = pgTable("collections_policies", {
	id: integer().default(1).primaryKey().notNull(),
	reminderDays: integer("reminder_days").default(10).notNull(),
	lateNoticeDays: integer("late_notice_days").default(30).notNull(),
	demandLetterDays: integer("demand_letter_days").default(60).notNull(),
	lienDays: integer("lien_days").default(90).notNull(),
	attorneyDays: integer("attorney_days").default(120).notNull(),
	active: boolean().default(true).notNull(),
	updatedAt: text("updated_at"),
});

export const dogParkAmenitySettings = pgTable("dog_park_amenity_settings", {
	id: serial().primaryKey().notNull(),
	amenityId: integer("amenity_id").notNull(),
	settings: jsonb().default({}).notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.amenityId],
			foreignColumns: [amenities.id],
			name: "dog_park_amenity_settings_amenity_id_amenities_id_fk"
		}).onDelete("cascade"),
	unique("dog_park_amenity_settings_amenity_id_unique").on(table.amenityId),
]);

export const emergencyBypasses = pgTable("emergency_bypasses", {
	id: serial().primaryKey().notNull(),
	targetType: text("target_type").notNull(),
	targetId: text("target_id").notNull(),
	action: text().notNull(),
	reason: text().notNull(),
	byUserId: integer("by_user_id"),
	byUserName: text("by_user_name").default(').notNull(),
	ratificationMotionId: integer("ratification_motion_id"),
	ratificationStatus: text("ratification_status").default('pending').notNull(),
	reversalRequired: boolean("reversal_required").default(false).notNull(),
	consumedAt: text("consumed_at"),
	payload: jsonb(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.byUserId],
			foreignColumns: [users.id],
			name: "emergency_bypasses_by_user_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.ratificationMotionId],
			foreignColumns: [motions.id],
			name: "emergency_bypasses_ratification_motion_id_motions_id_fk"
		}),
]);

export const complianceItems = pgTable("compliance_items", {
	id: serial().primaryKey().notNull(),
	kind: text().notNull(),
	title: text().notNull(),
	description: text().default(').notNull(),
	dueDate: text("due_date").notNull(),
	recurrence: jsonb(),
	status: text().default('open').notNull(),
	ownerUserId: integer("owner_user_id"),
	reminderLeadsMinutes: jsonb("reminder_leads_minutes").default([43200,10080,1440]).notNull(),
	notes: text().default(').notNull(),
	completedAt: text("completed_at"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
});

export const documentImportBatches = pgTable("document_import_batches", {
	id: text().primaryKey().notNull(),
	label: text(),
	status: text().default('committed').notNull(),
	fileCount: integer("file_count").default(0).notNull(),
	defaultCategory: text("default_category"),
	defaultBuilding: integer("default_building"),
	defaultUnit: text("default_unit"),
	defaultSource: text("default_source").default('imported').notNull(),
	defaultIsHistorical: boolean("default_is_historical").default(true).notNull(),
	createdBy: integer("created_by"),
	createdByName: text("created_by_name"),
	createdAt: text("created_at").notNull(),
	undoneAt: text("undone_at"),
	undoneBy: integer("undone_by"),
	undoneByName: text("undone_by_name"),
	notes: text(),
});

export const documentOcrJobs = pgTable("document_ocr_jobs", {
	id: serial().primaryKey().notNull(),
	storageKey: text("storage_key").notNull(),
	fileName: text("file_name").default(').notNull(),
	contentType: text("content_type"),
	status: text().default('queued').notNull(),
	attempts: integer().default(0).notNull(),
	lastError: text("last_error"),
	suggestions: jsonb(),
	fullText: text("full_text"),
	pageCount: integer("page_count").default(0).notNull(),
	enqueuedBy: integer("enqueued_by"),
	createdAt: text("created_at").notNull(),
	startedAt: text("started_at"),
	completedAt: text("completed_at"),
}, (table) => [
	unique("document_ocr_jobs_storage_key_unique").on(table.storageKey),
]);

export const electionCycles = pgTable("election_cycles", {
	id: serial().primaryKey().notNull(),
	year: integer().notNull(),
	label: text().notNull(),
	nominationsOpenOn: text("nominations_open_on"),
	nominationsCloseOn: text("nominations_close_on"),
	ballotMailingOn: text("ballot_mailing_on"),
	electionDayOn: text("election_day_on"),
	notes: text().default(').notNull(),
	createdAt: text("created_at").notNull(),
});

export const committees = pgTable("committees", {
	id: serial().primaryKey().notNull(),
	slug: text().notNull(),
	name: text().notNull(),
	description: text().default(').notNull(),
	subCalendarId: integer("sub_calendar_id"),
	active: boolean().default(true).notNull(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.subCalendarId],
			foreignColumns: [calendarSubCalendars.id],
			name: "committees_sub_calendar_id_calendar_sub_calendars_id_fk"
		}).onDelete("set null"),
	unique("committees_slug_unique").on(table.slug),
]);

export const guestParkingPermits = pgTable("guest_parking_permits", {
	id: serial().primaryKey().notNull(),
	unitId: text("unit_id").notNull(),
	ownerUserId: integer("owner_user_id").notNull(),
	permitNumber: text("permit_number").notNull(),
	numberYear: integer("number_year").notNull(),
	numberSeq: integer("number_seq").notNull(),
	startsOn: text("starts_on").notNull(),
	endsOn: text("ends_on").notNull(),
	nights: integer().notNull(),
	guestName: text("guest_name").default(').notNull(),
	plate: text().notNull(),
	plateState: text("plate_state").default(').notNull(),
	vehicleMake: text("vehicle_make").default(').notNull(),
	vehicleModel: text("vehicle_model").default(').notNull(),
	vehicleColor: text("vehicle_color").default(').notNull(),
	vehicleDesc: text("vehicle_desc").default(').notNull(),
	notes: text().default(').notNull(),
	status: text().default('active').notNull(),
	agreementSignedName: text("agreement_signed_name").default(').notNull(),
	agreementSignedAt: text("agreement_signed_at"),
	agreementSignedIp: text("agreement_signed_ip"),
	qrToken: text("qr_token").notNull(),
	pdfStorageKey: text("pdf_storage_key"),
	cancelledAt: text("cancelled_at"),
	cancelledByUserId: integer("cancelled_by_user_id"),
	cancellationReason: text("cancellation_reason").default(').notNull(),
	createdByUserId: integer("created_by_user_id"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "guest_parking_permits_unit_id_units_id_fk"
		}).onDelete("cascade"),
	unique("guest_parking_permits_permit_number_unique").on(table.permitNumber),
	unique("guest_parking_permits_qr_token_unique").on(table.qrToken),
]);

export const inspections = pgTable("inspections", {
	id: serial().primaryKey().notNull(),
	kind: text().notNull(),
	title: text().notNull(),
	scheduledOn: text("scheduled_on").notNull(),
	durationMinutes: integer("duration_minutes").default(120).notNull(),
	assigneeUserId: integer("assignee_user_id"),
	assigneeName: text("assignee_name"),
	buildingNum: integer("building_num"),
	vendorId: integer("vendor_id"),
	agency: text(),
	status: text().default('scheduled').notNull(),
	notes: text().default(').notNull(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.assigneeUserId],
			foreignColumns: [users.id],
			name: "inspections_assignee_user_id_users_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.buildingNum],
			foreignColumns: [buildings.num],
			name: "inspections_building_num_buildings_num_fk"
		}),
	foreignKey({
			columns: [table.vendorId],
			foreignColumns: [vendors.id],
			name: "inspections_vendor_id_vendors_id_fk"
		}),
]);

export const guestParkingLookups = pgTable("guest_parking_lookups", {
	id: serial().primaryKey().notNull(),
	query: text().notNull(),
	plate: text().default(').notNull(),
	result: text().notNull(),
	permitId: integer("permit_id"),
	unitId: text("unit_id"),
	patrolUserId: integer("patrol_user_id"),
	patrolName: text("patrol_name").default(').notNull(),
	notes: text().default(').notNull(),
	createdAt: text("created_at").notNull(),
});

export const insurancePolicyHistoryDocuments = pgTable("insurance_policy_history_documents", {
	id: serial().primaryKey().notNull(),
	historyId: integer("history_id").notNull(),
	documentId: text("document_id").notNull(),
	kind: text().default('other').notNull(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.historyId],
			foreignColumns: [insurancePolicyHistory.id],
			name: "insurance_policy_history_documents_history_id_insurance_policy_"
		}).onDelete("cascade"),
]);

export const guestParkingSettings = pgTable("guest_parking_settings", {
	id: serial().primaryKey().notNull(),
	config: jsonb().notNull(),
	updatedAt: text("updated_at").notNull(),
	updatedByUserId: integer("updated_by_user_id"),
});

export const hearings = pgTable("hearings", {
	id: serial().primaryKey().notNull(),
	kind: text().notNull(),
	refType: text("ref_type"),
	refId: integer("ref_id"),
	title: text().notNull(),
	scheduledAt: text("scheduled_at").notNull(),
	locationText: text("location_text"),
	locationUrl: text("location_url"),
	noticeDate: text("notice_date"),
	status: text().default('scheduled').notNull(),
	outcome: text(),
	createdByUserId: integer("created_by_user_id"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
});

export const fobInventory = pgTable("fob_inventory", {
	id: serial().primaryKey().notNull(),
	serial: text().notNull(),
	status: text().default('available').notNull(),
	zoneTags: jsonb("zone_tags").default([]).notNull(),
	notes: text().default(').notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	unique("fob_inventory_serial_unique").on(table.serial),
]);

export const lifecycleItems = pgTable("lifecycle_items", {
	id: serial().primaryKey().notNull(),
	kind: text().notNull(),
	title: text().notNull(),
	buildingNum: integer("building_num"),
	lastDoneOn: text("last_done_on"),
	intervalMonths: integer("interval_months").default(12).notNull(),
	equipmentName: text("equipment_name"),
	recurrence: jsonb(),
	checklist: jsonb().default([]).notNull(),
	notes: text().default(').notNull(),
	active: boolean().default(true).notNull(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.buildingNum],
			foreignColumns: [buildings.num],
			name: "lifecycle_items_building_num_buildings_num_fk"
		}),
]);

export const mailHoldWindows = pgTable("mail_hold_windows", {
	id: serial().primaryKey().notNull(),
	unitId: text("unit_id").notNull(),
	startsOn: text("starts_on").notNull(),
	endsOn: text("ends_on").notNull(),
	note: text().default(').notNull(),
	createdByUserId: integer("created_by_user_id"),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "mail_hold_windows_unit_id_units_id_fk"
		}).onDelete("cascade"),
]);

export const meetingAgendaItems = pgTable("meeting_agenda_items", {
	id: serial().primaryKey().notNull(),
	meetingId: integer("meeting_id").notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	kind: text().default('discussion').notNull(),
	title: text().notNull(),
	notes: text(),
	motionId: integer("motion_id"),
	presenter: text(),
	itemMinutes: text("item_minutes").default(').notNull(),
	closedSession: boolean("closed_session").default(false).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.meetingId],
			foreignColumns: [meetings.id],
			name: "meeting_agenda_items_meeting_id_meetings_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.motionId],
			foreignColumns: [motions.id],
			name: "meeting_agenda_items_motion_id_motions_id_fk"
		}).onDelete("set null"),
]);

export const meetings = pgTable("meetings", {
	id: serial().primaryKey().notNull(),
	kind: text().default('open').notNull(),
	title: text().notNull(),
	scheduledAt: text("scheduled_at").notNull(),
	durationMinutes: integer("duration_minutes").default(60).notNull(),
	locationPhysical: text("location_physical"),
	locationVideoLink: text("location_video_link"),
	noticeText: text("notice_text").default(').notNull(),
	noticePostedAt: text("notice_posted_at"),
	status: text().default('scheduled').notNull(),
	startedAt: text("started_at"),
	adjournedAt: text("adjourned_at"),
	agendaPacketStorageKey: text("agenda_packet_storage_key"),
	agendaPacketGeneratedAt: text("agenda_packet_generated_at"),
	minutesContent: text("minutes_content").default(').notNull(),
	minutesStatus: text("minutes_status").default('none').notNull(),
	minutesAdoptionMotionId: integer("minutes_adoption_motion_id"),
	minutesAdoptedAt: text("minutes_adopted_at"),
	minutesStorageKey: text("minutes_storage_key"),
	quorumMode: text("quorum_mode"),
	quorumPercentBp: integer("quorum_percent_bp"),
	createdByUserId: integer("created_by_user_id"),
	createdByName: text("created_by_name").default(').notNull(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.createdByUserId],
			foreignColumns: [users.id],
			name: "meetings_created_by_user_id_users_id_fk"
		}),
]);

export const meetingAttendance = pgTable("meeting_attendance", {
	id: serial().primaryKey().notNull(),
	meetingId: integer("meeting_id").notNull(),
	userId: integer("user_id").notNull(),
	userName: text("user_name").default(').notNull(),
	status: text().default('absent').notNull(),
	isBoardMember: boolean("is_board_member").default(false).notNull(),
	recordedAt: text("recorded_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.meetingId],
			foreignColumns: [meetings.id],
			name: "meeting_attendance_meeting_id_meetings_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "meeting_attendance_user_id_users_id_fk"
		}),
	unique("meeting_attendance_meeting_id_user_id_unique").on(table.meetingId, table.userId),
]);

export const motionAttachments = pgTable("motion_attachments", {
	id: serial().primaryKey().notNull(),
	motionId: integer("motion_id").notNull(),
	name: text().notNull(),
	size: integer().default(0).notNull(),
	contentType: text("content_type"),
	storageKey: text("storage_key").notNull(),
	uploadedByUserId: integer("uploaded_by_user_id"),
	uploadedByName: text("uploaded_by_name").default(').notNull(),
	uploadedAt: text("uploaded_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.motionId],
			foreignColumns: [motions.id],
			name: "motion_attachments_motion_id_motions_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.uploadedByUserId],
			foreignColumns: [users.id],
			name: "motion_attachments_uploaded_by_user_id_users_id_fk"
		}),
]);

export const insurancePolicyHistory = pgTable("insurance_policy_history", {
	id: serial().primaryKey().notNull(),
	building: integer().notNull(),
	carrier: text().notNull(),
	policyNo: text("policy_no").notNull(),
	coverage: integer().notNull(),
	premium: integer().notNull(),
	effectiveFrom: text("effective_from").notNull(),
	effectiveTo: text("effective_to").notNull(),
	endedReason: text("ended_reason"),
	notes: text(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.building],
			foreignColumns: [buildings.num],
			name: "insurance_policy_history_building_buildings_num_fk"
		}),
]);

export const motionVotes = pgTable("motion_votes", {
	id: serial().primaryKey().notNull(),
	motionId: integer("motion_id").notNull(),
	userId: integer("user_id").notNull(),
	userName: text("user_name").default(').notNull(),
	decision: text().notNull(),
	comment: text(),
	bodyHashAtVote: text("body_hash_at_vote"),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.motionId],
			foreignColumns: [motions.id],
			name: "motion_votes_motion_id_motions_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "motion_votes_user_id_users_id_fk"
		}),
	unique("motion_votes_motion_id_user_id_unique").on(table.motionId, table.userId),
]);

export const notices = pgTable("notices", {
	id: serial().primaryKey().notNull(),
	kind: text().notNull(),
	title: text().notNull(),
	body: text().default(').notNull(),
	sourceType: text("source_type").notNull(),
	sourceId: integer("source_id").notNull(),
	meetingId: integer("meeting_id"),
	postedAt: text("posted_at").notNull(),
	requiredWindowDays: integer("required_window_days"),
}, (table) => [
	unique("notices_kind_source_type_source_id_unique").on(table.kind, table.sourceType, table.sourceId),
]);

export const packageAudit = pgTable("package_audit", {
	id: serial().primaryKey().notNull(),
	packageId: integer("package_id").notNull(),
	action: text().notNull(),
	actorUserId: integer("actor_user_id"),
	actorName: text("actor_name").default(').notNull(),
	diff: jsonb(),
	createdAt: text("created_at").notNull(),
});

export const packageLockers = pgTable("package_lockers", {
	id: serial().primaryKey().notNull(),
	bankSlug: text("bank_slug").default('default').notNull(),
	bay: text().notNull(),
	size: text().default('medium').notNull(),
	notes: text().default(').notNull(),
	outOfService: boolean("out_of_service").default(false).notNull(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	unique("package_lockers_bank_slug_bay_unique").on(table.bankSlug, table.bay),
]);

export const petAudit = pgTable("pet_audit", {
	id: serial().primaryKey().notNull(),
	petId: integer("pet_id"),
	unitId: text("unit_id"),
	action: text().notNull(),
	actorUserId: integer("actor_user_id"),
	actorName: text("actor_name").default(').notNull(),
	diff: jsonb(),
	createdAt: text("created_at").notNull(),
});

export const motions = pgTable("motions", {
	id: serial().primaryKey().notNull(),
	kind: text().notNull(),
	title: text().notNull(),
	body: text().default(').notNull(),
	bodyHash: text("body_hash"),
	votingRule: jsonb("voting_rule").notNull(),
	status: text().default('draft').notNull(),
	outcome: text(),
	createdByUserId: integer("created_by_user_id"),
	createdByName: text("created_by_name").default(').notNull(),
	createdAt: text("created_at").notNull(),
	openedAt: text("opened_at"),
	closesAt: text("closes_at"),
	resolvedAt: text("resolved_at"),
	reminderSentAt: text("reminder_sent_at"),
	meetingId: integer("meeting_id"),
	payload: jsonb(),
}, (table) => [
	foreignKey({
			columns: [table.createdByUserId],
			foreignColumns: [users.id],
			name: "motions_created_by_user_id_users_id_fk"
		}),
]);

export const packages = pgTable("packages", {
	id: serial().primaryKey().notNull(),
	unitId: text("unit_id").notNull(),
	recipientUserId: integer("recipient_user_id"),
	recipientName: text("recipient_name").default(').notNull(),
	carrier: text().default('Other').notNull(),
	trackingNumber: text("tracking_number").default(').notNull(),
	size: text().default('medium').notNull(),
	notes: text().default(').notNull(),
	intakePhotoStorageKey: text("intake_photo_storage_key"),
	pickupPhotoStorageKey: text("pickup_photo_storage_key"),
	pickupCode: text("pickup_code").notNull(),
	qrPayload: text("qr_payload").notNull(),
	lockerId: integer("locker_id"),
	lockerPin: text("locker_pin"),
	status: text().default('received').notNull(),
	heldUntil: text("held_until"),
	staleAt: text("stale_at"),
	rtsAt: text("rts_at"),
	pickedUpAt: text("picked_up_at"),
	pickedUpByName: text("picked_up_by_name").default(').notNull(),
	pickedUpByUserId: integer("picked_up_by_user_id"),
	intakeByUserId: integer("intake_by_user_id"),
	intakeByName: text("intake_by_name").default(').notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.lockerId],
			foreignColumns: [packageLockers.id],
			name: "packages_locker_id_package_lockers_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.recipientUserId],
			foreignColumns: [users.id],
			name: "packages_recipient_user_id_users_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "packages_unit_id_units_id_fk"
		}).onDelete("cascade"),
	unique("packages_pickup_code_unique").on(table.pickupCode),
]);

export const petVaccinations = pgTable("pet_vaccinations", {
	id: serial().primaryKey().notNull(),
	petId: integer("pet_id").notNull(),
	vaccineType: text("vaccine_type").notNull(),
	administeredOn: text("administered_on").notNull(),
	expiresOn: text("expires_on").notNull(),
	certificateStorageKey: text("certificate_storage_key"),
	notes: text().default(').notNull(),
	uploadedByUserId: integer("uploaded_by_user_id"),
	uploadedByName: text("uploaded_by_name").default(').notNull(),
	remindersSent: jsonb("reminders_sent").default([]).notNull(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.petId],
			foreignColumns: [pets.id],
			name: "pet_vaccinations_pet_id_pets_id_fk"
		}).onDelete("cascade"),
]);

export const phoneVerifications = pgTable("phone_verifications", {
	id: serial().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	phoneNumber: text("phone_number").notNull(),
	codeHash: text("code_hash").notNull(),
	attempts: integer().default(0).notNull(),
	expiresAt: text("expires_at").notNull(),
	consumedAt: text("consumed_at"),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "phone_verifications_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const poolTags = pgTable("pool_tags", {
	id: serial().primaryKey().notNull(),
	unitId: text("unit_id").notNull(),
	residentUserId: integer("resident_user_id"),
	residentName: text("resident_name").default(').notNull(),
	photoStorageKey: text("photo_storage_key"),
	expiresAt: text("expires_at"),
	status: text().default('active').notNull(),
	suspendedReason: text("suspended_reason").default(').notNull(),
	suspendedAt: text("suspended_at"),
	issuedAt: text("issued_at").notNull(),
	issuedByUserId: integer("issued_by_user_id"),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.residentUserId],
			foreignColumns: [users.id],
			name: "pool_tags_resident_user_id_users_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "pool_tags_unit_id_units_id_fk"
		}).onDelete("cascade"),
]);

export const resolutions = pgTable("resolutions", {
	id: serial().primaryKey().notNull(),
	motionId: integer("motion_id").notNull(),
	category: text().default('other').notNull(),
	number: text(),
	numberYear: integer("number_year"),
	numberSeq: integer("number_seq"),
	supersededByResolutionId: integer("superseded_by_resolution_id"),
	rescindedByMotionId: integer("rescinded_by_motion_id"),
	pdfStorageKey: text("pdf_storage_key"),
	createdAt: text("created_at").notNull(),
	adoptedAt: text("adopted_at"),
	public: boolean().default(false).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.motionId],
			foreignColumns: [motions.id],
			name: "resolutions_motion_id_motions_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.rescindedByMotionId],
			foreignColumns: [motions.id],
			name: "resolutions_rescinded_by_motion_id_motions_id_fk"
		}).onDelete("set null"),
	unique("resolutions_motion_id_unique").on(table.motionId),
]);

export const reserveProjects = pgTable("reserve_projects", {
	id: serial().primaryKey().notNull(),
	name: text().notNull(),
	category: text().default('other').notNull(),
	estimatedCostCents: integer("estimated_cost_cents").default(0).notNull(),
	fundingDate: text("funding_date"),
	bidWindowStart: text("bid_window_start"),
	bidWindowEnd: text("bid_window_end"),
	scheduledStart: text("scheduled_start"),
	scheduledEnd: text("scheduled_end"),
	status: text().default('planned').notNull(),
	notes: text().default(').notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
});

export const specialAssessments = pgTable("special_assessments", {
	id: serial().primaryKey().notNull(),
	title: text().notNull(),
	description: text().default(').notNull(),
	amountCents: integer("amount_cents").notNull(),
	status: text().default('draft').notNull(),
	noticeDate: text("notice_date"),
	hearingDate: text("hearing_date"),
	hearingLocation: text("hearing_location"),
	adoptionDate: text("adoption_date"),
	billingDate: text("billing_date"),
	dueDate: text("due_date"),
	motionId: integer("motion_id"),
	notes: text().default(').notNull(),
	createdByUserId: integer("created_by_user_id"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
});

export const petDogparkAgreements = pgTable("pet_dogpark_agreements", {
	id: serial().primaryKey().notNull(),
	unitId: text("unit_id").notNull(),
	signedByUserId: integer("signed_by_user_id"),
	signedByName: text("signed_by_name").default(').notNull(),
	signedIp: text("signed_ip"),
	agreementText: text("agreement_text").default(').notNull(),
	signedAt: text("signed_at").notNull(),
	expiresAt: text("expires_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "pet_dogpark_agreements_unit_id_units_id_fk"
		}).onDelete("cascade"),
]);

export const pets = pgTable("pets", {
	id: serial().primaryKey().notNull(),
	unitId: text("unit_id").notNull(),
	filedByUserId: integer("filed_by_user_id"),
	filedByName: text("filed_by_name").default(').notNull(),
	name: text().notNull(),
	species: text().default('dog').notNull(),
	breed: text().default(').notNull(),
	weightLbs: integer("weight_lbs").default(0).notNull(),
	sex: text().default('unknown').notNull(),
	spayedNeutered: boolean("spayed_neutered").default(false).notNull(),
	color: text().default(').notNull(),
	photoStorageKey: text("photo_storage_key"),
	microchipNumber: text("microchip_number").default(').notNull(),
	vetName: text("vet_name").default(').notNull(),
	vetPhone: text("vet_phone").default(').notNull(),
	notes: text().default(').notNull(),
	status: text().default('non_compliant').notNull(),
	approvalState: text("approval_state").default('approved').notNull(),
	approvedByUserId: integer("approved_by_user_id"),
	approvedAt: text("approved_at"),
	suspendedUntil: text("suspended_until"),
	suspendedReason: text("suspended_reason").default(').notNull(),
	archivedAt: text("archived_at"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "pets_unit_id_units_id_fk"
		}).onDelete("cascade"),
]);

export const trashHolidayShifts = pgTable("trash_holiday_shifts", {
	id: serial().primaryKey().notNull(),
	holidayDate: text("holiday_date").notNull(),
	label: text().notNull(),
	shiftDays: integer("shift_days").notNull(),
	weekdays: text().default(').notNull(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	unique("trash_holiday_shifts_holiday_date_label_unique").on(table.holidayDate, table.label),
]);

export const vendorContracts = pgTable("vendor_contracts", {
	id: serial().primaryKey().notNull(),
	vendorId: integer("vendor_id").notNull(),
	serviceType: text("service_type").notNull(),
	title: text().notNull(),
	recurrence: jsonb(),
	firstServiceOn: text("first_service_on").notNull(),
	durationMinutes: integer("duration_minutes").default(60).notNull(),
	active: boolean().default(true).notNull(),
	contractDocStorageKey: text("contract_doc_storage_key"),
	notes: text().default(').notNull(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.vendorId],
			foreignColumns: [vendors.id],
			name: "vendor_contracts_vendor_id_vendors_id_fk"
		}).onDelete("cascade"),
]);

export const amenityAccessCodes = pgTable("amenity_access_codes", {
	id: serial().primaryKey().notNull(),
	bookingId: integer("booking_id").notNull(),
	amenityId: integer("amenity_id").notNull(),
	code: text().notNull(),
	qrPayload: text("qr_payload").notNull(),
	validFrom: text("valid_from").notNull(),
	validTo: text("valid_to").notNull(),
	status: text().default('active').notNull(),
	providerKind: text("provider_kind").default('none').notNull(),
	providerRef: text("provider_ref"),
	issuedAt: text("issued_at").notNull(),
	revokedAt: text("revoked_at"),
}, (table) => [
	foreignKey({
			columns: [table.amenityId],
			foreignColumns: [amenities.id],
			name: "amenity_access_codes_amenity_id_amenities_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.bookingId],
			foreignColumns: [amenityBookings.id],
			name: "amenity_access_codes_booking_id_amenity_bookings_id_fk"
		}).onDelete("cascade"),
	unique("amenity_access_codes_booking_id_unique").on(table.bookingId),
	unique("amenity_access_codes_code_unique").on(table.code),
]);

export const amenityIncidentAttachments = pgTable("amenity_incident_attachments", {
	id: serial().primaryKey().notNull(),
	incidentId: integer("incident_id").notNull(),
	storageKey: text("storage_key").notNull(),
	caption: text().default(').notNull(),
	uploadedByUserId: integer("uploaded_by_user_id"),
	uploadedByName: text("uploaded_by_name").default(').notNull(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.incidentId],
			foreignColumns: [amenityIncidentReports.id],
			name: "amenity_incident_attachments_incident_id_amenity_incident_repor"
		}).onDelete("cascade"),
]);

export const calendarEventAttachments = pgTable("calendar_event_attachments", {
	id: serial().primaryKey().notNull(),
	eventId: integer("event_id").notNull(),
	name: text().notNull(),
	size: integer().default(0).notNull(),
	contentType: text("content_type"),
	storageKey: text("storage_key").notNull(),
	uploadedByUserId: integer("uploaded_by_user_id"),
	uploadedByName: text("uploaded_by_name").default(').notNull(),
	uploadedAt: text("uploaded_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [calendarEvents.id],
			name: "calendar_event_attachments_event_id_calendar_events_id_fk"
		}).onDelete("cascade"),
]);

export const chargingIdleEvents = pgTable("charging_idle_events", {
	id: serial().primaryKey().notNull(),
	sessionId: integer("session_id").notNull(),
	startedAt: text("started_at").notNull(),
	endedAt: text("ended_at"),
	minutes: integer().default(0).notNull(),
	feeCents: integer("fee_cents").default(0).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [chargingSessions.id],
			name: "charging_idle_events_session_id_charging_sessions_id_fk"
		}).onDelete("cascade"),
]);

export const committeeMembers = pgTable("committee_members", {
	id: serial().primaryKey().notNull(),
	committeeId: integer("committee_id").notNull(),
	userId: integer("user_id").notNull(),
	role: text().default('member').notNull(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.committeeId],
			foreignColumns: [committees.id],
			name: "committee_members_committee_id_committees_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "committee_members_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("committee_members_committee_id_user_id_unique").on(table.committeeId, table.userId),
]);

export const fobAssignments = pgTable("fob_assignments", {
	id: serial().primaryKey().notNull(),
	fobId: integer("fob_id").notNull(),
	unitId: text("unit_id"),
	bookingId: integer("booking_id"),
	assignedToUserId: integer("assigned_to_user_id"),
	assignedToName: text("assigned_to_name").default(').notNull(),
	assignedAt: text("assigned_at").notNull(),
	returnedAt: text("returned_at"),
	returnedNote: text("returned_note").default(').notNull(),
	assignedByUserId: integer("assigned_by_user_id"),
}, (table) => [
	foreignKey({
			columns: [table.bookingId],
			foreignColumns: [amenityBookings.id],
			name: "fob_assignments_booking_id_amenity_bookings_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.fobId],
			foreignColumns: [fobInventory.id],
			name: "fob_assignments_fob_id_fob_inventory_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "fob_assignments_unit_id_units_id_fk"
		}).onDelete("set null"),
]);

export const meetingAgendaComments = pgTable("meeting_agenda_comments", {
	id: serial().primaryKey().notNull(),
	agendaItemId: integer("agenda_item_id").notNull(),
	meetingId: integer("meeting_id").notNull(),
	ownerUserId: integer("owner_user_id").notNull(),
	ownerName: text("owner_name").default(').notNull(),
	unitId: text("unit_id"),
	body: text().notNull(),
	createdAt: text("created_at").notNull(),
	editedAt: text("edited_at"),
	deletedAt: text("deleted_at"),
}, (table) => [
	foreignKey({
			columns: [table.agendaItemId],
			foreignColumns: [meetingAgendaItems.id],
			name: "meeting_agenda_comments_agenda_item_id_meeting_agenda_items_id_"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.meetingId],
			foreignColumns: [meetings.id],
			name: "meeting_agenda_comments_meeting_id_meetings_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.ownerUserId],
			foreignColumns: [users.id],
			name: "meeting_agenda_comments_owner_user_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "meeting_agenda_comments_unit_id_units_id_fk"
		}),
]);

export const packagePickupAuthorizations = pgTable("package_pickup_authorizations", {
	id: serial().primaryKey().notNull(),
	packageId: integer("package_id").notNull(),
	authorizedName: text("authorized_name").notNull(),
	authorizedUserId: integer("authorized_user_id"),
	note: text().default(').notNull(),
	createdByUserId: integer("created_by_user_id"),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.packageId],
			foreignColumns: [packages.id],
			name: "package_pickup_authorizations_package_id_packages_id_fk"
		}).onDelete("cascade"),
]);

export const petIncidents = pgTable("pet_incidents", {
	id: serial().primaryKey().notNull(),
	petId: integer("pet_id").notNull(),
	unitId: text("unit_id").notNull(),
	occurredAt: text("occurred_at").notNull(),
	kind: text().notNull(),
	severity: text().default('minor').notNull(),
	description: text().default(').notNull(),
	reportedByUserId: integer("reported_by_user_id"),
	reportedByName: text("reported_by_name").default(').notNull(),
	resolution: text().default(').notNull(),
	resolvedAt: text("resolved_at"),
	resolvedByUserId: integer("resolved_by_user_id"),
	status: text().default('open').notNull(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.petId],
			foreignColumns: [pets.id],
			name: "pet_incidents_pet_id_pets_id_fk"
		}).onDelete("cascade"),
]);

export const unitVehicles = pgTable("unit_vehicles", {
	id: serial().primaryKey().notNull(),
	unitId: text("unit_id").notNull(),
	plate: text().notNull(),
	state: text().default(').notNull(),
	make: text().default(').notNull(),
	model: text().default(').notNull(),
	color: text().default(').notNull(),
	notes: text().default(').notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "unit_vehicles_unit_id_units_id_fk"
		}).onDelete("cascade"),
]);

export const vendorCertificates = pgTable("vendor_certificates", {
	id: serial().primaryKey().notNull(),
	vendorId: integer("vendor_id").notNull(),
	kind: text().notNull(),
	expiresOn: text("expires_on").notNull(),
	documentStorageKey: text("document_storage_key"),
	notes: text().default(').notNull(),
	createdAt: text("created_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.vendorId],
			foreignColumns: [vendors.id],
			name: "vendor_certificates_vendor_id_vendors_id_fk"
		}).onDelete("cascade"),
]);

export const violations = pgTable("violations", {
	id: serial().primaryKey().notNull(),
	unitId: text("unit_id").notNull(),
	ownerUserId: integer("owner_user_id"),
	ownerName: text("owner_name").default(').notNull(),
	category: text().notNull(),
	description: text().notNull(),
	status: text().default('open').notNull(),
	observedAt: text("observed_at").notNull(),
	firstNoticeDate: text("first_notice_date"),
	cureDeadline: text("cure_deadline"),
	secondNoticeDate: text("second_notice_date"),
	hearingDate: text("hearing_date"),
	resolvedAt: text("resolved_at"),
	fineCents: integer("fine_cents").default(0).notNull(),
	createdByUserId: integer("created_by_user_id"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "violations_unit_id_units_id_fk"
		}),
]);

export const glossaryEditHistory = pgTable("glossary_edit_history", {
	id: serial().primaryKey().notNull(),
	termId: integer("term_id").notNull(),
	termKey: text("term_key").notNull(),
	action: text().notNull(),
	actorUserId: integer("actor_user_id"),
	actorName: text("actor_name").default(').notNull(),
	diff: jsonb(),
	createdAt: text("created_at").notNull(),
});

export const glossaryTerms = pgTable("glossary_terms", {
	id: serial().primaryKey().notNull(),
	termKey: text("term_key").notNull(),
	title: text().notNull(),
	category: text().notNull(),
	shortDef: text("short_def").notNull(),
	longDef: text("long_def").default(').notNull(),
	seeAlsoRoute: text("see_also_route"),
	published: boolean().default(true).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	unique("glossary_terms_term_key_unique").on(table.termKey),
]);

export const glossaryRouteMappings = pgTable("glossary_route_mappings", {
	id: serial().primaryKey().notNull(),
	termId: integer("term_id").notNull(),
	route: text().notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.termId],
			foreignColumns: [glossaryTerms.id],
			name: "glossary_route_mappings_term_id_glossary_terms_id_fk"
		}).onDelete("cascade"),
	unique("glossary_route_mappings_term_id_route_unique").on(table.termId, table.route),
]);

export const glossarySuggestions = pgTable("glossary_suggestions", {
	id: serial().primaryKey().notNull(),
	termId: integer("term_id").notNull(),
	proposedTitle: text("proposed_title").default(').notNull(),
	proposedShortDef: text("proposed_short_def").default(').notNull(),
	proposedLongDef: text("proposed_long_def").default(').notNull(),
	reason: text().default(').notNull(),
	status: text().default('pending').notNull(),
	submittedByUserId: integer("submitted_by_user_id"),
	submittedByName: text("submitted_by_name").default(').notNull(),
	reviewedByUserId: integer("reviewed_by_user_id"),
	reviewedByName: text("reviewed_by_name").default(').notNull(),
	reviewNote: text("review_note").default(').notNull(),
	createdAt: text("created_at").notNull(),
	reviewedAt: text("reviewed_at"),
}, (table) => [
	foreignKey({
			columns: [table.termId],
			foreignColumns: [glossaryTerms.id],
			name: "glossary_suggestions_term_id_glossary_terms_id_fk"
		}).onDelete("cascade"),
]);

export const userOnboarding = pgTable("user_onboarding", {
	userId: integer("user_id").primaryKey().notNull(),
	tourCompleted: boolean("tour_completed").default(false).notNull(),
	tourCompletedAt: text("tour_completed_at"),
	tourReplayedAt: text("tour_replayed_at"),
	updatedAt: text("updated_at").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_onboarding_user_id_users_id_fk"
		}).onDelete("cascade"),
]);
