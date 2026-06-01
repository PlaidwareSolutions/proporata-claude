import { relations } from "drizzle-orm/relations";
import { buildings, insurancePolicies, documents, units, ownerAccounts, ledgerEntries, mapMarkers, workOrders, workOrderAttachments, bidQuotes, bidQuoteLines, bidScopeItems, workOrderEvents, bidRequests, bidInvitations, vendors, bidAttachments, users, architecturalRequests, accAttachments, accEvents, ownerPaymentMethods, paymentAttempts, boardMemberAudit, amenityInspectionTemplates, amenityInspectionTemplateItems, amenityBookings, amenityInspections, amenityInspectionItemResults, amenityDamageReports, amenityDamageDisputes, amenityDepositLedger, amenities, amenityAnnualInspections, amenityBlackouts, amenityAccessProviders, amenityExpenseEntries, amenityIncidentReports, amenityIncidentAudit, amenityLifeguardWindows, amenityRequiredPostings, amenityPostingIssuances, amenityCertificates, amenityEmergencyProcedures, buildingSystems, buildingSystemDocuments, buildingSystemInspections, buildingSystemRepairs, amenitySafetyPins, bookingGuestPasses, calendarEvents, calendarEventReminders, calendarEventRsvps, calendarSubCalendars, calendarExternalFeeds, calendarResources, calendarUserPrefs, chargingPorts, chargingSessions, chargingReservations, chargingSessionUsageSamples, dogParkAmenitySettings, emergencyBypasses, motions, committees, guestParkingPermits, inspections, insurancePolicyHistory, insurancePolicyHistoryDocuments, lifecycleItems, mailHoldWindows, meetings, meetingAgendaItems, meetingAttendance, motionAttachments, motionVotes, packageLockers, packages, pets, petVaccinations, phoneVerifications, poolTags, resolutions, petDogparkAgreements, vendorContracts, amenityAccessCodes, amenityIncidentAttachments, calendarEventAttachments, chargingIdleEvents, committeeMembers, fobAssignments, fobInventory, meetingAgendaComments, packagePickupAuthorizations, petIncidents, unitVehicles, vendorCertificates, violations, glossaryTerms, glossaryRouteMappings, glossarySuggestions, userOnboarding } from "./schema";

export const insurancePoliciesRelations = relations(insurancePolicies, ({one}) => ({
	building: one(buildings, {
		fields: [insurancePolicies.building],
		references: [buildings.num]
	}),
}));

export const buildingsRelations = relations(buildings, ({many}) => ({
	insurancePolicies: many(insurancePolicies),
	documents: many(documents),
	units: many(units),
	mapMarkers: many(mapMarkers),
	architecturalRequests: many(architecturalRequests),
	bidRequests: many(bidRequests),
	workOrders: many(workOrders),
	buildingSystems: many(buildingSystems),
	inspections: many(inspections),
	lifecycleItems: many(lifecycleItems),
	insurancePolicyHistories: many(insurancePolicyHistory),
}));

export const documentsRelations = relations(documents, ({one}) => ({
	building: one(buildings, {
		fields: [documents.building],
		references: [buildings.num]
	}),
	unit: one(units, {
		fields: [documents.unit],
		references: [units.id]
	}),
}));

export const unitsRelations = relations(units, ({one, many}) => ({
	documents: many(documents),
	building: one(buildings, {
		fields: [units.building],
		references: [buildings.num]
	}),
	users: many(users),
	architecturalRequests: many(architecturalRequests),
	bidRequests: many(bidRequests),
	ownerAccounts: many(ownerAccounts),
	workOrders: many(workOrders),
	guestParkingPermits: many(guestParkingPermits),
	mailHoldWindows: many(mailHoldWindows),
	packages: many(packages),
	poolTags: many(poolTags),
	petDogparkAgreements: many(petDogparkAgreements),
	pets: many(pets),
	fobAssignments: many(fobAssignments),
	meetingAgendaComments: many(meetingAgendaComments),
	unitVehicles: many(unitVehicles),
	violations: many(violations),
}));

export const ledgerEntriesRelations = relations(ledgerEntries, ({one}) => ({
	ownerAccount: one(ownerAccounts, {
		fields: [ledgerEntries.ownerAccountId],
		references: [ownerAccounts.id]
	}),
}));

export const ownerAccountsRelations = relations(ownerAccounts, ({one, many}) => ({
	ledgerEntries: many(ledgerEntries),
	unit: one(units, {
		fields: [ownerAccounts.unitId],
		references: [units.id]
	}),
	ownerPaymentMethods: many(ownerPaymentMethods),
	paymentAttempts: many(paymentAttempts),
}));

export const mapMarkersRelations = relations(mapMarkers, ({one}) => ({
	building: one(buildings, {
		fields: [mapMarkers.buildingNum],
		references: [buildings.num]
	}),
}));

export const workOrderAttachmentsRelations = relations(workOrderAttachments, ({one}) => ({
	workOrder: one(workOrders, {
		fields: [workOrderAttachments.workOrderId],
		references: [workOrders.id]
	}),
}));

export const workOrdersRelations = relations(workOrders, ({one, many}) => ({
	workOrderAttachments: many(workOrderAttachments),
	workOrderEvents: many(workOrderEvents),
	bidRequests_awardedWorkOrderId: many(bidRequests, {
		relationName: "bidRequests_awardedWorkOrderId_workOrders_id"
	}),
	bidRequests_sourceWorkOrderId: many(bidRequests, {
		relationName: "bidRequests_sourceWorkOrderId_workOrders_id"
	}),
	building: one(buildings, {
		fields: [workOrders.building],
		references: [buildings.num]
	}),
	unit: one(units, {
		fields: [workOrders.unit],
		references: [units.id]
	}),
	vendor: one(vendors, {
		fields: [workOrders.vendorId],
		references: [vendors.id]
	}),
}));

export const bidQuoteLinesRelations = relations(bidQuoteLines, ({one}) => ({
	bidQuote: one(bidQuotes, {
		fields: [bidQuoteLines.bidQuoteId],
		references: [bidQuotes.id]
	}),
	bidScopeItem: one(bidScopeItems, {
		fields: [bidQuoteLines.scopeItemId],
		references: [bidScopeItems.id]
	}),
}));

export const bidQuotesRelations = relations(bidQuotes, ({one, many}) => ({
	bidQuoteLines: many(bidQuoteLines),
	bidRequest: one(bidRequests, {
		fields: [bidQuotes.bidRequestId],
		references: [bidRequests.id]
	}),
	bidInvitation: one(bidInvitations, {
		fields: [bidQuotes.invitationId],
		references: [bidInvitations.id]
	}),
	vendor: one(vendors, {
		fields: [bidQuotes.vendorId],
		references: [vendors.id]
	}),
}));

export const bidScopeItemsRelations = relations(bidScopeItems, ({one, many}) => ({
	bidQuoteLines: many(bidQuoteLines),
	bidRequest: one(bidRequests, {
		fields: [bidScopeItems.bidRequestId],
		references: [bidRequests.id]
	}),
}));

export const workOrderEventsRelations = relations(workOrderEvents, ({one}) => ({
	workOrder: one(workOrders, {
		fields: [workOrderEvents.workOrderId],
		references: [workOrders.id]
	}),
}));

export const bidInvitationsRelations = relations(bidInvitations, ({one, many}) => ({
	bidRequest: one(bidRequests, {
		fields: [bidInvitations.bidRequestId],
		references: [bidRequests.id]
	}),
	vendor: one(vendors, {
		fields: [bidInvitations.vendorId],
		references: [vendors.id]
	}),
	bidQuotes: many(bidQuotes),
}));

export const bidRequestsRelations = relations(bidRequests, ({one, many}) => ({
	bidInvitations: many(bidInvitations),
	bidAttachments: many(bidAttachments),
	bidQuotes: many(bidQuotes),
	vendor: one(vendors, {
		fields: [bidRequests.awardedVendorId],
		references: [vendors.id]
	}),
	workOrder_awardedWorkOrderId: one(workOrders, {
		fields: [bidRequests.awardedWorkOrderId],
		references: [workOrders.id],
		relationName: "bidRequests_awardedWorkOrderId_workOrders_id"
	}),
	building: one(buildings, {
		fields: [bidRequests.buildingNum],
		references: [buildings.num]
	}),
	user: one(users, {
		fields: [bidRequests.createdBy],
		references: [users.id]
	}),
	workOrder_sourceWorkOrderId: one(workOrders, {
		fields: [bidRequests.sourceWorkOrderId],
		references: [workOrders.id],
		relationName: "bidRequests_sourceWorkOrderId_workOrders_id"
	}),
	unit: one(units, {
		fields: [bidRequests.unitId],
		references: [units.id]
	}),
	bidScopeItems: many(bidScopeItems),
}));

export const vendorsRelations = relations(vendors, ({many}) => ({
	bidInvitations: many(bidInvitations),
	bidQuotes: many(bidQuotes),
	bidRequests: many(bidRequests),
	workOrders: many(workOrders),
	amenityCertificates: many(amenityCertificates),
	inspections: many(inspections),
	vendorContracts: many(vendorContracts),
	vendorCertificates: many(vendorCertificates),
}));

export const bidAttachmentsRelations = relations(bidAttachments, ({one}) => ({
	bidRequest: one(bidRequests, {
		fields: [bidAttachments.bidRequestId],
		references: [bidRequests.id]
	}),
}));

export const usersRelations = relations(users, ({one, many}) => ({
	unit: one(units, {
		fields: [users.unitId],
		references: [units.id]
	}),
	accAttachments: many(accAttachments),
	architecturalRequests: many(architecturalRequests),
	accEvents: many(accEvents),
	bidRequests: many(bidRequests),
	boardMemberAudits_changedByUserId: many(boardMemberAudit, {
		relationName: "boardMemberAudit_changedByUserId_users_id"
	}),
	boardMemberAudits_userId: many(boardMemberAudit, {
		relationName: "boardMemberAudit_userId_users_id"
	}),
	calendarEventRsvps: many(calendarEventRsvps),
	calendarUserPrefs: many(calendarUserPrefs),
	emergencyBypasses: many(emergencyBypasses),
	inspections: many(inspections),
	meetings: many(meetings),
	meetingAttendances: many(meetingAttendance),
	motionAttachments: many(motionAttachments),
	motionVotes: many(motionVotes),
	motions: many(motions),
	packages: many(packages),
	phoneVerifications: many(phoneVerifications),
	poolTags: many(poolTags),
	committeeMembers: many(committeeMembers),
	meetingAgendaComments: many(meetingAgendaComments),
	userOnboardings: many(userOnboarding),
}));

export const accAttachmentsRelations = relations(accAttachments, ({one}) => ({
	architecturalRequest: one(architecturalRequests, {
		fields: [accAttachments.requestId],
		references: [architecturalRequests.id]
	}),
	user: one(users, {
		fields: [accAttachments.uploadedByUserId],
		references: [users.id]
	}),
}));

export const architecturalRequestsRelations = relations(architecturalRequests, ({one, many}) => ({
	accAttachments: many(accAttachments),
	building: one(buildings, {
		fields: [architecturalRequests.building],
		references: [buildings.num]
	}),
	user: one(users, {
		fields: [architecturalRequests.ownerUserId],
		references: [users.id]
	}),
	unit: one(units, {
		fields: [architecturalRequests.unitId],
		references: [units.id]
	}),
	accEvents: many(accEvents),
}));

export const accEventsRelations = relations(accEvents, ({one}) => ({
	user: one(users, {
		fields: [accEvents.authorUserId],
		references: [users.id]
	}),
	architecturalRequest: one(architecturalRequests, {
		fields: [accEvents.requestId],
		references: [architecturalRequests.id]
	}),
}));

export const ownerPaymentMethodsRelations = relations(ownerPaymentMethods, ({one}) => ({
	ownerAccount: one(ownerAccounts, {
		fields: [ownerPaymentMethods.ownerAccountId],
		references: [ownerAccounts.id]
	}),
}));

export const paymentAttemptsRelations = relations(paymentAttempts, ({one}) => ({
	ownerAccount: one(ownerAccounts, {
		fields: [paymentAttempts.ownerAccountId],
		references: [ownerAccounts.id]
	}),
}));

export const boardMemberAuditRelations = relations(boardMemberAudit, ({one}) => ({
	user_changedByUserId: one(users, {
		fields: [boardMemberAudit.changedByUserId],
		references: [users.id],
		relationName: "boardMemberAudit_changedByUserId_users_id"
	}),
	user_userId: one(users, {
		fields: [boardMemberAudit.userId],
		references: [users.id],
		relationName: "boardMemberAudit_userId_users_id"
	}),
}));

export const amenityInspectionTemplateItemsRelations = relations(amenityInspectionTemplateItems, ({one}) => ({
	amenityInspectionTemplate: one(amenityInspectionTemplates, {
		fields: [amenityInspectionTemplateItems.templateId],
		references: [amenityInspectionTemplates.id]
	}),
}));

export const amenityInspectionTemplatesRelations = relations(amenityInspectionTemplates, ({many}) => ({
	amenityInspectionTemplateItems: many(amenityInspectionTemplateItems),
}));

export const amenityInspectionsRelations = relations(amenityInspections, ({one, many}) => ({
	amenityBooking: one(amenityBookings, {
		fields: [amenityInspections.bookingId],
		references: [amenityBookings.id]
	}),
	amenityInspectionItemResults: many(amenityInspectionItemResults),
}));

export const amenityBookingsRelations = relations(amenityBookings, ({one, many}) => ({
	amenityInspections: many(amenityInspections),
	amenityDamageReports: many(amenityDamageReports),
	amenityDepositLedgers: many(amenityDepositLedger),
	amenity: one(amenities, {
		fields: [amenityBookings.amenityId],
		references: [amenities.id]
	}),
	amenityIncidentReports: many(amenityIncidentReports),
	bookingGuestPasses: many(bookingGuestPasses),
	amenityAccessCodes: many(amenityAccessCodes),
	fobAssignments: many(fobAssignments),
}));

export const amenityInspectionItemResultsRelations = relations(amenityInspectionItemResults, ({one}) => ({
	amenityInspection: one(amenityInspections, {
		fields: [amenityInspectionItemResults.inspectionId],
		references: [amenityInspections.id]
	}),
}));

export const amenityDamageReportsRelations = relations(amenityDamageReports, ({one, many}) => ({
	amenityBooking: one(amenityBookings, {
		fields: [amenityDamageReports.bookingId],
		references: [amenityBookings.id]
	}),
	amenityDamageDisputes: many(amenityDamageDisputes),
}));

export const amenityDamageDisputesRelations = relations(amenityDamageDisputes, ({one}) => ({
	amenityDamageReport: one(amenityDamageReports, {
		fields: [amenityDamageDisputes.damageReportId],
		references: [amenityDamageReports.id]
	}),
}));

export const amenityDepositLedgerRelations = relations(amenityDepositLedger, ({one}) => ({
	amenityBooking: one(amenityBookings, {
		fields: [amenityDepositLedger.bookingId],
		references: [amenityBookings.id]
	}),
}));

export const amenityAnnualInspectionsRelations = relations(amenityAnnualInspections, ({one}) => ({
	amenity: one(amenities, {
		fields: [amenityAnnualInspections.amenityId],
		references: [amenities.id]
	}),
}));

export const amenitiesRelations = relations(amenities, ({many}) => ({
	amenityAnnualInspections: many(amenityAnnualInspections),
	amenityBlackouts: many(amenityBlackouts),
	amenityAccessProviders: many(amenityAccessProviders),
	amenityBookings: many(amenityBookings),
	amenityExpenseEntries: many(amenityExpenseEntries),
	amenityIncidentReports: many(amenityIncidentReports),
	amenityLifeguardWindows: many(amenityLifeguardWindows),
	amenityRequiredPostings: many(amenityRequiredPostings),
	amenityPostingIssuances: many(amenityPostingIssuances),
	amenityCertificates: many(amenityCertificates),
	amenityEmergencyProcedures: many(amenityEmergencyProcedures),
	amenitySafetyPins: many(amenitySafetyPins),
	chargingPorts: many(chargingPorts),
	dogParkAmenitySettings: many(dogParkAmenitySettings),
	amenityAccessCodes: many(amenityAccessCodes),
}));

export const amenityBlackoutsRelations = relations(amenityBlackouts, ({one}) => ({
	amenity: one(amenities, {
		fields: [amenityBlackouts.amenityId],
		references: [amenities.id]
	}),
}));

export const amenityAccessProvidersRelations = relations(amenityAccessProviders, ({one}) => ({
	amenity: one(amenities, {
		fields: [amenityAccessProviders.amenityId],
		references: [amenities.id]
	}),
}));

export const amenityExpenseEntriesRelations = relations(amenityExpenseEntries, ({one}) => ({
	amenity: one(amenities, {
		fields: [amenityExpenseEntries.amenityId],
		references: [amenities.id]
	}),
}));

export const amenityIncidentReportsRelations = relations(amenityIncidentReports, ({one, many}) => ({
	amenity: one(amenities, {
		fields: [amenityIncidentReports.amenityId],
		references: [amenities.id]
	}),
	amenityBooking: one(amenityBookings, {
		fields: [amenityIncidentReports.bookingId],
		references: [amenityBookings.id]
	}),
	amenityIncidentAudits: many(amenityIncidentAudit),
	amenityIncidentAttachments: many(amenityIncidentAttachments),
}));

export const amenityIncidentAuditRelations = relations(amenityIncidentAudit, ({one}) => ({
	amenityIncidentReport: one(amenityIncidentReports, {
		fields: [amenityIncidentAudit.incidentId],
		references: [amenityIncidentReports.id]
	}),
}));

export const amenityLifeguardWindowsRelations = relations(amenityLifeguardWindows, ({one}) => ({
	amenity: one(amenities, {
		fields: [amenityLifeguardWindows.amenityId],
		references: [amenities.id]
	}),
}));

export const amenityRequiredPostingsRelations = relations(amenityRequiredPostings, ({one, many}) => ({
	amenity: one(amenities, {
		fields: [amenityRequiredPostings.amenityId],
		references: [amenities.id]
	}),
	amenityPostingIssuances: many(amenityPostingIssuances),
}));

export const amenityPostingIssuancesRelations = relations(amenityPostingIssuances, ({one}) => ({
	amenity: one(amenities, {
		fields: [amenityPostingIssuances.amenityId],
		references: [amenities.id]
	}),
	amenityRequiredPosting: one(amenityRequiredPostings, {
		fields: [amenityPostingIssuances.postingId],
		references: [amenityRequiredPostings.id]
	}),
}));

export const amenityCertificatesRelations = relations(amenityCertificates, ({one}) => ({
	amenity: one(amenities, {
		fields: [amenityCertificates.amenityId],
		references: [amenities.id]
	}),
	vendor: one(vendors, {
		fields: [amenityCertificates.vendorId],
		references: [vendors.id]
	}),
}));

export const amenityEmergencyProceduresRelations = relations(amenityEmergencyProcedures, ({one}) => ({
	amenity: one(amenities, {
		fields: [amenityEmergencyProcedures.amenityId],
		references: [amenities.id]
	}),
}));

export const buildingSystemDocumentsRelations = relations(buildingSystemDocuments, ({one}) => ({
	buildingSystem: one(buildingSystems, {
		fields: [buildingSystemDocuments.systemId],
		references: [buildingSystems.id]
	}),
}));

export const buildingSystemsRelations = relations(buildingSystems, ({one, many}) => ({
	buildingSystemDocuments: many(buildingSystemDocuments),
	buildingSystemInspections: many(buildingSystemInspections),
	buildingSystemRepairs: many(buildingSystemRepairs),
	building: one(buildings, {
		fields: [buildingSystems.building],
		references: [buildings.num]
	}),
}));

export const buildingSystemInspectionsRelations = relations(buildingSystemInspections, ({one}) => ({
	buildingSystem: one(buildingSystems, {
		fields: [buildingSystemInspections.systemId],
		references: [buildingSystems.id]
	}),
}));

export const buildingSystemRepairsRelations = relations(buildingSystemRepairs, ({one}) => ({
	buildingSystem: one(buildingSystems, {
		fields: [buildingSystemRepairs.systemId],
		references: [buildingSystems.id]
	}),
}));

export const amenitySafetyPinsRelations = relations(amenitySafetyPins, ({one}) => ({
	amenity: one(amenities, {
		fields: [amenitySafetyPins.amenityId],
		references: [amenities.id]
	}),
}));

export const bookingGuestPassesRelations = relations(bookingGuestPasses, ({one}) => ({
	amenityBooking: one(amenityBookings, {
		fields: [bookingGuestPasses.bookingId],
		references: [amenityBookings.id]
	}),
}));

export const calendarEventRemindersRelations = relations(calendarEventReminders, ({one}) => ({
	calendarEvent: one(calendarEvents, {
		fields: [calendarEventReminders.eventId],
		references: [calendarEvents.id]
	}),
}));

export const calendarEventsRelations = relations(calendarEvents, ({one, many}) => ({
	calendarEventReminders: many(calendarEventReminders),
	calendarEventRsvps: many(calendarEventRsvps),
	calendarResource: one(calendarResources, {
		fields: [calendarEvents.resourceId],
		references: [calendarResources.id]
	}),
	calendarSubCalendar: one(calendarSubCalendars, {
		fields: [calendarEvents.subCalendarId],
		references: [calendarSubCalendars.id]
	}),
	calendarEventAttachments: many(calendarEventAttachments),
}));

export const calendarEventRsvpsRelations = relations(calendarEventRsvps, ({one}) => ({
	calendarEvent: one(calendarEvents, {
		fields: [calendarEventRsvps.eventId],
		references: [calendarEvents.id]
	}),
	user: one(users, {
		fields: [calendarEventRsvps.userId],
		references: [users.id]
	}),
}));

export const calendarExternalFeedsRelations = relations(calendarExternalFeeds, ({one}) => ({
	calendarSubCalendar: one(calendarSubCalendars, {
		fields: [calendarExternalFeeds.subCalendarId],
		references: [calendarSubCalendars.id]
	}),
}));

export const calendarSubCalendarsRelations = relations(calendarSubCalendars, ({many}) => ({
	calendarExternalFeeds: many(calendarExternalFeeds),
	calendarEvents: many(calendarEvents),
	committees: many(committees),
}));

export const calendarResourcesRelations = relations(calendarResources, ({many}) => ({
	calendarEvents: many(calendarEvents),
}));

export const calendarUserPrefsRelations = relations(calendarUserPrefs, ({one}) => ({
	user: one(users, {
		fields: [calendarUserPrefs.userId],
		references: [users.id]
	}),
}));

export const chargingSessionsRelations = relations(chargingSessions, ({one, many}) => ({
	chargingPort: one(chargingPorts, {
		fields: [chargingSessions.portId],
		references: [chargingPorts.id]
	}),
	chargingSessionUsageSamples: many(chargingSessionUsageSamples),
	chargingIdleEvents: many(chargingIdleEvents),
}));

export const chargingPortsRelations = relations(chargingPorts, ({one, many}) => ({
	chargingSessions: many(chargingSessions),
	amenity: one(amenities, {
		fields: [chargingPorts.amenityId],
		references: [amenities.id]
	}),
	chargingReservations: many(chargingReservations),
}));

export const chargingReservationsRelations = relations(chargingReservations, ({one}) => ({
	chargingPort: one(chargingPorts, {
		fields: [chargingReservations.portId],
		references: [chargingPorts.id]
	}),
}));

export const chargingSessionUsageSamplesRelations = relations(chargingSessionUsageSamples, ({one}) => ({
	chargingSession: one(chargingSessions, {
		fields: [chargingSessionUsageSamples.sessionId],
		references: [chargingSessions.id]
	}),
}));

export const dogParkAmenitySettingsRelations = relations(dogParkAmenitySettings, ({one}) => ({
	amenity: one(amenities, {
		fields: [dogParkAmenitySettings.amenityId],
		references: [amenities.id]
	}),
}));

export const emergencyBypassesRelations = relations(emergencyBypasses, ({one}) => ({
	user: one(users, {
		fields: [emergencyBypasses.byUserId],
		references: [users.id]
	}),
	motion: one(motions, {
		fields: [emergencyBypasses.ratificationMotionId],
		references: [motions.id]
	}),
}));

export const motionsRelations = relations(motions, ({one, many}) => ({
	emergencyBypasses: many(emergencyBypasses),
	meetingAgendaItems: many(meetingAgendaItems),
	motionAttachments: many(motionAttachments),
	motionVotes: many(motionVotes),
	user: one(users, {
		fields: [motions.createdByUserId],
		references: [users.id]
	}),
	resolutions_motionId: many(resolutions, {
		relationName: "resolutions_motionId_motions_id"
	}),
	resolutions_rescindedByMotionId: many(resolutions, {
		relationName: "resolutions_rescindedByMotionId_motions_id"
	}),
}));

export const committeesRelations = relations(committees, ({one, many}) => ({
	calendarSubCalendar: one(calendarSubCalendars, {
		fields: [committees.subCalendarId],
		references: [calendarSubCalendars.id]
	}),
	committeeMembers: many(committeeMembers),
}));

export const guestParkingPermitsRelations = relations(guestParkingPermits, ({one}) => ({
	unit: one(units, {
		fields: [guestParkingPermits.unitId],
		references: [units.id]
	}),
}));

export const inspectionsRelations = relations(inspections, ({one}) => ({
	user: one(users, {
		fields: [inspections.assigneeUserId],
		references: [users.id]
	}),
	building: one(buildings, {
		fields: [inspections.buildingNum],
		references: [buildings.num]
	}),
	vendor: one(vendors, {
		fields: [inspections.vendorId],
		references: [vendors.id]
	}),
}));

export const insurancePolicyHistoryDocumentsRelations = relations(insurancePolicyHistoryDocuments, ({one}) => ({
	insurancePolicyHistory: one(insurancePolicyHistory, {
		fields: [insurancePolicyHistoryDocuments.historyId],
		references: [insurancePolicyHistory.id]
	}),
}));

export const insurancePolicyHistoryRelations = relations(insurancePolicyHistory, ({one, many}) => ({
	insurancePolicyHistoryDocuments: many(insurancePolicyHistoryDocuments),
	building: one(buildings, {
		fields: [insurancePolicyHistory.building],
		references: [buildings.num]
	}),
}));

export const lifecycleItemsRelations = relations(lifecycleItems, ({one}) => ({
	building: one(buildings, {
		fields: [lifecycleItems.buildingNum],
		references: [buildings.num]
	}),
}));

export const mailHoldWindowsRelations = relations(mailHoldWindows, ({one}) => ({
	unit: one(units, {
		fields: [mailHoldWindows.unitId],
		references: [units.id]
	}),
}));

export const meetingAgendaItemsRelations = relations(meetingAgendaItems, ({one, many}) => ({
	meeting: one(meetings, {
		fields: [meetingAgendaItems.meetingId],
		references: [meetings.id]
	}),
	motion: one(motions, {
		fields: [meetingAgendaItems.motionId],
		references: [motions.id]
	}),
	meetingAgendaComments: many(meetingAgendaComments),
}));

export const meetingsRelations = relations(meetings, ({one, many}) => ({
	meetingAgendaItems: many(meetingAgendaItems),
	user: one(users, {
		fields: [meetings.createdByUserId],
		references: [users.id]
	}),
	meetingAttendances: many(meetingAttendance),
	meetingAgendaComments: many(meetingAgendaComments),
}));

export const meetingAttendanceRelations = relations(meetingAttendance, ({one}) => ({
	meeting: one(meetings, {
		fields: [meetingAttendance.meetingId],
		references: [meetings.id]
	}),
	user: one(users, {
		fields: [meetingAttendance.userId],
		references: [users.id]
	}),
}));

export const motionAttachmentsRelations = relations(motionAttachments, ({one}) => ({
	motion: one(motions, {
		fields: [motionAttachments.motionId],
		references: [motions.id]
	}),
	user: one(users, {
		fields: [motionAttachments.uploadedByUserId],
		references: [users.id]
	}),
}));

export const motionVotesRelations = relations(motionVotes, ({one}) => ({
	motion: one(motions, {
		fields: [motionVotes.motionId],
		references: [motions.id]
	}),
	user: one(users, {
		fields: [motionVotes.userId],
		references: [users.id]
	}),
}));

export const packagesRelations = relations(packages, ({one, many}) => ({
	packageLocker: one(packageLockers, {
		fields: [packages.lockerId],
		references: [packageLockers.id]
	}),
	user: one(users, {
		fields: [packages.recipientUserId],
		references: [users.id]
	}),
	unit: one(units, {
		fields: [packages.unitId],
		references: [units.id]
	}),
	packagePickupAuthorizations: many(packagePickupAuthorizations),
}));

export const packageLockersRelations = relations(packageLockers, ({many}) => ({
	packages: many(packages),
}));

export const petVaccinationsRelations = relations(petVaccinations, ({one}) => ({
	pet: one(pets, {
		fields: [petVaccinations.petId],
		references: [pets.id]
	}),
}));

export const petsRelations = relations(pets, ({one, many}) => ({
	petVaccinations: many(petVaccinations),
	unit: one(units, {
		fields: [pets.unitId],
		references: [units.id]
	}),
	petIncidents: many(petIncidents),
}));

export const phoneVerificationsRelations = relations(phoneVerifications, ({one}) => ({
	user: one(users, {
		fields: [phoneVerifications.userId],
		references: [users.id]
	}),
}));

export const poolTagsRelations = relations(poolTags, ({one}) => ({
	user: one(users, {
		fields: [poolTags.residentUserId],
		references: [users.id]
	}),
	unit: one(units, {
		fields: [poolTags.unitId],
		references: [units.id]
	}),
}));

export const resolutionsRelations = relations(resolutions, ({one}) => ({
	motion_motionId: one(motions, {
		fields: [resolutions.motionId],
		references: [motions.id],
		relationName: "resolutions_motionId_motions_id"
	}),
	motion_rescindedByMotionId: one(motions, {
		fields: [resolutions.rescindedByMotionId],
		references: [motions.id],
		relationName: "resolutions_rescindedByMotionId_motions_id"
	}),
}));

export const petDogparkAgreementsRelations = relations(petDogparkAgreements, ({one}) => ({
	unit: one(units, {
		fields: [petDogparkAgreements.unitId],
		references: [units.id]
	}),
}));

export const vendorContractsRelations = relations(vendorContracts, ({one}) => ({
	vendor: one(vendors, {
		fields: [vendorContracts.vendorId],
		references: [vendors.id]
	}),
}));

export const amenityAccessCodesRelations = relations(amenityAccessCodes, ({one}) => ({
	amenity: one(amenities, {
		fields: [amenityAccessCodes.amenityId],
		references: [amenities.id]
	}),
	amenityBooking: one(amenityBookings, {
		fields: [amenityAccessCodes.bookingId],
		references: [amenityBookings.id]
	}),
}));

export const amenityIncidentAttachmentsRelations = relations(amenityIncidentAttachments, ({one}) => ({
	amenityIncidentReport: one(amenityIncidentReports, {
		fields: [amenityIncidentAttachments.incidentId],
		references: [amenityIncidentReports.id]
	}),
}));

export const calendarEventAttachmentsRelations = relations(calendarEventAttachments, ({one}) => ({
	calendarEvent: one(calendarEvents, {
		fields: [calendarEventAttachments.eventId],
		references: [calendarEvents.id]
	}),
}));

export const chargingIdleEventsRelations = relations(chargingIdleEvents, ({one}) => ({
	chargingSession: one(chargingSessions, {
		fields: [chargingIdleEvents.sessionId],
		references: [chargingSessions.id]
	}),
}));

export const committeeMembersRelations = relations(committeeMembers, ({one}) => ({
	committee: one(committees, {
		fields: [committeeMembers.committeeId],
		references: [committees.id]
	}),
	user: one(users, {
		fields: [committeeMembers.userId],
		references: [users.id]
	}),
}));

export const fobAssignmentsRelations = relations(fobAssignments, ({one}) => ({
	amenityBooking: one(amenityBookings, {
		fields: [fobAssignments.bookingId],
		references: [amenityBookings.id]
	}),
	fobInventory: one(fobInventory, {
		fields: [fobAssignments.fobId],
		references: [fobInventory.id]
	}),
	unit: one(units, {
		fields: [fobAssignments.unitId],
		references: [units.id]
	}),
}));

export const fobInventoryRelations = relations(fobInventory, ({many}) => ({
	fobAssignments: many(fobAssignments),
}));

export const meetingAgendaCommentsRelations = relations(meetingAgendaComments, ({one}) => ({
	meetingAgendaItem: one(meetingAgendaItems, {
		fields: [meetingAgendaComments.agendaItemId],
		references: [meetingAgendaItems.id]
	}),
	meeting: one(meetings, {
		fields: [meetingAgendaComments.meetingId],
		references: [meetings.id]
	}),
	user: one(users, {
		fields: [meetingAgendaComments.ownerUserId],
		references: [users.id]
	}),
	unit: one(units, {
		fields: [meetingAgendaComments.unitId],
		references: [units.id]
	}),
}));

export const packagePickupAuthorizationsRelations = relations(packagePickupAuthorizations, ({one}) => ({
	package: one(packages, {
		fields: [packagePickupAuthorizations.packageId],
		references: [packages.id]
	}),
}));

export const petIncidentsRelations = relations(petIncidents, ({one}) => ({
	pet: one(pets, {
		fields: [petIncidents.petId],
		references: [pets.id]
	}),
}));

export const unitVehiclesRelations = relations(unitVehicles, ({one}) => ({
	unit: one(units, {
		fields: [unitVehicles.unitId],
		references: [units.id]
	}),
}));

export const vendorCertificatesRelations = relations(vendorCertificates, ({one}) => ({
	vendor: one(vendors, {
		fields: [vendorCertificates.vendorId],
		references: [vendors.id]
	}),
}));

export const violationsRelations = relations(violations, ({one}) => ({
	unit: one(units, {
		fields: [violations.unitId],
		references: [units.id]
	}),
}));

export const glossaryRouteMappingsRelations = relations(glossaryRouteMappings, ({one}) => ({
	glossaryTerm: one(glossaryTerms, {
		fields: [glossaryRouteMappings.termId],
		references: [glossaryTerms.id]
	}),
}));

export const glossaryTermsRelations = relations(glossaryTerms, ({many}) => ({
	glossaryRouteMappings: many(glossaryRouteMappings),
	glossarySuggestions: many(glossarySuggestions),
}));

export const glossarySuggestionsRelations = relations(glossarySuggestions, ({one}) => ({
	glossaryTerm: one(glossaryTerms, {
		fields: [glossarySuggestions.termId],
		references: [glossaryTerms.id]
	}),
}));

export const userOnboardingRelations = relations(userOnboarding, ({one}) => ({
	user: one(users, {
		fields: [userOnboarding.userId],
		references: [users.id]
	}),
}));