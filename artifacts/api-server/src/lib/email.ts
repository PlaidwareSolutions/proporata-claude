const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL ?? "HOA Hub <noreply@hoahub.app>";

export interface EmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export async function sendEmail(
  to: string | string[],
  subject: string,
  html: string,
  text?: string,
): Promise<EmailResult> {
  const recipients = Array.isArray(to) ? to : [to];

  if (!RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — email not sent:", subject, "to", recipients);
    return { ok: true, id: "no-op" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: recipients,
        subject,
        html,
        text: text ?? html.replace(/<[^>]+>/g, ""),
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[email] Resend error:", err);
      return { ok: false, error: err };
    }

    const data = (await res.json()) as { id?: string };
    return { ok: true, id: data.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[email] sendEmail failed:", msg);
    return { ok: false, error: msg };
  }
}

export function buildWorkOrderEmail(opts: {
  orgName: string;
  title: string;
  priority: string;
  building: number;
  id: string;
}) {
  const priorityLabel = opts.priority === "urgent" ? "🔴 Urgent" : "🟠 High";
  return `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">${priorityLabel} Work Order: ${opts.title}</h2>
  <p style="color:#555;margin:0 0 16px">${opts.orgName} — Building ${opts.building}</p>
  <p style="color:#333">A new work order has been created that requires attention.</p>
  <p style="color:#888;font-size:13px">Work order ID: ${opts.id}</p>
</div>`;
}

export function buildInsuranceExpiryEmail(opts: {
  orgName: string;
  building: number;
  carrier: string;
  expires: string;
  daysLeft: number;
}) {
  return `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">⚠️ Insurance Expiring Soon — Building ${opts.building}</h2>
  <p style="color:#555;margin:0 0 16px">${opts.orgName}</p>
  <p style="color:#333">The insurance policy for <strong>Building ${opts.building}</strong> (${opts.carrier}) expires in <strong>${opts.daysLeft} day${opts.daysLeft === 1 ? "" : "s"}</strong> on ${opts.expires}.</p>
  <p style="color:#333">Please renew the policy before it lapses.</p>
</div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildWorkOrderCommentEmail(opts: {
  orgName: string;
  workOrderId: string;
  workOrderTitle: string;
  building: number;
  actorName: string;
  text: string;
}) {
  const orgName = escapeHtml(opts.orgName);
  const title = escapeHtml(opts.workOrderTitle);
  const actor = escapeHtml(opts.actorName);
  const id = escapeHtml(opts.workOrderId);
  const body = escapeHtml(opts.text);
  return `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">💬 New comment on "${title}"</h2>
  <p style="color:#555;margin:0 0 16px">${orgName} — Building ${opts.building}</p>
  <p style="color:#333;margin:0 0 8px"><strong>${actor}</strong> commented:</p>
  <blockquote style="border-left:3px solid #ddd;margin:0 0 16px;padding:8px 12px;color:#333;white-space:pre-wrap">${body}</blockquote>
  <p style="color:#888;font-size:13px">Work order ID: ${id}</p>
</div>`;
}

export function buildBidInviteEmail(opts: {
  orgName: string; bidTitle: string; deadline: string; link: string; vendorName: string;
}) {
  const o = escapeHtml(opts.orgName); const t = escapeHtml(opts.bidTitle);
  const v = escapeHtml(opts.vendorName); const d = escapeHtml(opts.deadline.slice(0, 10));
  return `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">📋 You're invited to bid: ${t}</h2>
  <p style="color:#555;margin:0 0 16px">From ${o}</p>
  <p style="color:#333">Hello ${v}, you've been invited to submit a quote for the project above. Quotes are due by <strong>${d}</strong>.</p>
  <p style="margin:24px 0"><a href="${opts.link}" style="background:#3245FF;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Submit your quote</a></p>
  <p style="color:#555;font-size:13px;margin:0 0 8px">Not interested in this project? <a href="${opts.link}?action=decline" style="color:#3245FF;font-weight:600">Decline this invitation</a> so the manager knows you've seen it.</p>
  <p style="color:#888;font-size:12px">This link is unique to you. Do not share it.</p>
</div>`;
}

export function buildBidReminderEmail(opts: {
  orgName: string; bidTitle: string; deadline: string; daysLeft: number; vendorName: string;
}) {
  const o = escapeHtml(opts.orgName); const t = escapeHtml(opts.bidTitle);
  const v = escapeHtml(opts.vendorName); const d = escapeHtml(opts.deadline.slice(0, 10));
  return `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">⏰ Reminder — bid closes in ${opts.daysLeft} day${opts.daysLeft === 1 ? "" : "s"}</h2>
  <p style="color:#555;margin:0 0 16px">${o} — ${t}</p>
  <p style="color:#333">Hello ${v}, this is a friendly reminder that the bid above closes on <strong>${d}</strong>. Please submit your quote using the link in your original invitation.</p>
</div>`;
}

export function buildBidThankYouEmail(opts: {
  orgName: string; bidTitle: string; vendorName: string;
}) {
  const o = escapeHtml(opts.orgName); const t = escapeHtml(opts.bidTitle);
  const v = escapeHtml(opts.vendorName);
  return `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">Bid result — thank you</h2>
  <p style="color:#555;margin:0 0 16px">${o} — ${t}</p>
  <p style="color:#333">Hello ${v}, thank you for submitting a quote on the bid above. We have selected another vendor for this project. We appreciate your time and look forward to working with you on a future bid.</p>
</div>`;
}

export function paymentMethodLabelFromCharge(
  charge: { payment_method_details?: unknown } | null | undefined,
): string {
  const d = (charge as { payment_method_details?: {
    card?: { brand?: string | null; last4?: string | null } | null;
    us_bank_account?: { bank_name?: string | null; last4?: string | null } | null;
  } | null } | null | undefined)?.payment_method_details;
  if (!d) return "Online payment";
  if (d.card) {
    const brand = d.card.brand
      ? d.card.brand.charAt(0).toUpperCase() + d.card.brand.slice(1)
      : "Card";
    return d.card.last4 ? `${brand} ending in ${d.card.last4}` : brand;
  }
  if (d.us_bank_account) {
    const bank = d.us_bank_account.bank_name ?? "Bank account";
    return d.us_bank_account.last4 ? `${bank} ending in ${d.us_bank_account.last4}` : bank;
  }
  return "Online payment";
}

export function buildPaymentReceiptEmail(opts: {
  orgName: string;
  unitLabel: string;
  amountCents: number;
  surchargeCents: number;
  dateIso: string;
  paymentMethod: string;
  kind: "auto_pay" | "owner_initiated" | string;
  receiptUrl: string | null;
}) {
  const orgName = escapeHtml(opts.orgName);
  const unit = escapeHtml(opts.unitLabel);
  const method = escapeHtml(opts.paymentMethod);
  const date = escapeHtml(opts.dateIso.slice(0, 10));
  const baseDollars = (opts.amountCents / 100).toFixed(2);
  const surchargeDollars = (opts.surchargeCents / 100).toFixed(2);
  const totalDollars = ((opts.amountCents + opts.surchargeCents) / 100).toFixed(2);
  const kindLabel = opts.kind === "auto_pay" ? "Auto-pay" : "Online payment";
  const surchargeRow =
    opts.surchargeCents > 0
      ? `<tr><td style="padding:6px 0;color:#555">Processing fee</td><td style="padding:6px 0;text-align:right;color:#333">$${surchargeDollars}</td></tr>`
      : "";
  const receiptLink = opts.receiptUrl
    ? `<p style="margin:16px 0"><a href="${escapeHtml(opts.receiptUrl)}" style="background:#3245FF;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">View Stripe receipt</a></p>`
    : "";
  return `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">Payment received — Unit ${unit}</h2>
  <p style="color:#555;margin:0 0 16px">${orgName}</p>
  <p style="color:#333">Thank you — your ${kindLabel.toLowerCase()} of <strong>$${totalDollars}</strong> for Unit ${unit} on <strong>${date}</strong> has been received.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
    <tr><td style="padding:6px 0;color:#555">Type</td><td style="padding:6px 0;text-align:right;color:#333">${kindLabel}</td></tr>
    <tr><td style="padding:6px 0;color:#555">Payment method</td><td style="padding:6px 0;text-align:right;color:#333">${method}</td></tr>
    <tr><td style="padding:6px 0;color:#555">Amount</td><td style="padding:6px 0;text-align:right;color:#333">$${baseDollars}</td></tr>
    ${surchargeRow}
    <tr><td style="padding:6px 0;color:#555;border-top:1px solid #eee"><strong>Total charged</strong></td><td style="padding:6px 0;text-align:right;color:#333;border-top:1px solid #eee"><strong>$${totalDollars}</strong></td></tr>
  </table>
  ${receiptLink}
  <p style="color:#888;font-size:12px;margin-top:24px">This is an automated receipt from ${orgName}.</p>
</div>`;
}

export function buildPaymentRefundEmail(opts: {
  orgName: string;
  unitLabel: string;
  refundCents: number;
  dateIso: string;
  paymentMethod: string;
  receiptUrl: string | null;
}) {
  const orgName = escapeHtml(opts.orgName);
  const unit = escapeHtml(opts.unitLabel);
  const method = escapeHtml(opts.paymentMethod);
  const date = escapeHtml(opts.dateIso.slice(0, 10));
  const dollars = (opts.refundCents / 100).toFixed(2);
  const receiptLink = opts.receiptUrl
    ? `<p style="margin:16px 0"><a href="${escapeHtml(opts.receiptUrl)}" style="background:#3245FF;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">View Stripe receipt</a></p>`
    : "";
  return `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">Refund issued — Unit ${unit}</h2>
  <p style="color:#555;margin:0 0 16px">${orgName}</p>
  <p style="color:#333">A refund of <strong>$${dollars}</strong> has been issued to your <strong>${method}</strong> on <strong>${date}</strong>. It typically takes 5–10 business days to appear in your account.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
    <tr><td style="padding:6px 0;color:#555">Refund amount</td><td style="padding:6px 0;text-align:right;color:#333">$${dollars}</td></tr>
    <tr><td style="padding:6px 0;color:#555">Refunded to</td><td style="padding:6px 0;text-align:right;color:#333">${method}</td></tr>
    <tr><td style="padding:6px 0;color:#555">Date</td><td style="padding:6px 0;text-align:right;color:#333">${date}</td></tr>
    <tr><td style="padding:6px 0;color:#555">Unit</td><td style="padding:6px 0;text-align:right;color:#333">${unit}</td></tr>
  </table>
  ${receiptLink}
  <p style="color:#888;font-size:12px;margin-top:24px">This is an automated notice from ${orgName}.</p>
</div>`;
}

export function buildAutoPayInitiatedEmail(opts: {
  orgName: string;
  unitLabel: string;
  amountCents: number;
  surchargeCents: number;
  dateIso: string;
  paymentMethod: string;
}) {
  const orgName = escapeHtml(opts.orgName);
  const unit = escapeHtml(opts.unitLabel);
  const method = escapeHtml(opts.paymentMethod);
  const date = escapeHtml(opts.dateIso.slice(0, 10));
  const total = ((opts.amountCents + opts.surchargeCents) / 100).toFixed(2);
  return `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">Auto-pay initiated — Unit ${unit}</h2>
  <p style="color:#555;margin:0 0 16px">${orgName}</p>
  <p style="color:#333">A scheduled auto-pay charge of <strong>$${total}</strong> for Unit ${unit} was initiated on <strong>${date}</strong> using your saved ${method}. You'll receive a separate receipt once the charge settles.</p>
  <p style="color:#888;font-size:12px;margin-top:24px">This is an automated notice from ${orgName}.</p>
</div>`;
}

// Task #66: governance fan-out emails (meeting scheduled, agenda published,
// minutes adopted, resolution adopted). One reusable shell so the four
// notification kinds share a consistent look.
export function buildGovernanceEmail(opts: {
  orgName: string;
  headline: string;
  intro: string;
  detail?: string;
}) {
  const orgName = escapeHtml(opts.orgName);
  const headline = escapeHtml(opts.headline);
  const intro = escapeHtml(opts.intro);
  const detail = opts.detail
    ? `<div style="border-left:3px solid #ddd;margin:12px 0;padding:8px 12px;color:#333;white-space:pre-wrap;font-size:13px">${escapeHtml(opts.detail)}</div>`
    : "";
  return `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">${headline}</h2>
  <p style="color:#555;margin:0 0 16px">${orgName}</p>
  <p style="color:#333">${intro}</p>
  ${detail}
  <p style="color:#888;font-size:12px;margin-top:24px">This is an automated notice from ${orgName}. You can review the full record in your resident portal.</p>
</div>`;
}

export function buildAmenityBookingEmail(opts: {
  orgName: string;
  amenityName: string;
  ownerName: string;
  startsAt: string;
  endsAt: string;
  status: "confirmed" | "cancelled" | "reminder" | "refunded";
  reason?: string;
  managerNote?: string;
  permitNumber?: string | null;
  detailsUrl?: string;
}) {
  const o = escapeHtml(opts.orgName);
  const a = escapeHtml(opts.amenityName);
  const n = escapeHtml(opts.ownerName);
  const start = escapeHtml(new Date(opts.startsAt).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" }));
  const end = escapeHtml(new Date(opts.endsAt).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" }));
  const subjectMap = {
    confirmed: "Reservation confirmed",
    cancelled: "Reservation cancelled",
    reminder: "Reminder — your reservation is coming up",
    refunded: "Deposit refunded",
  } as const;
  const heading = subjectMap[opts.status];
  const reasonHtml = opts.reason
    ? `<p style="color:#333">Reason: ${escapeHtml(opts.reason)}</p>`
    : "";
  const noteHtml = opts.managerNote
    ? `<p style="color:#333">Note from manager: ${escapeHtml(opts.managerNote)}</p>`
    : "";
  const permitHtml = opts.permitNumber
    ? `<p style="color:#333"><strong>Permit #:</strong> ${escapeHtml(opts.permitNumber)}</p>`
    : "";
  const linkHtml = opts.detailsUrl
    ? `<p style="margin:24px 0"><a href="${escapeHtml(opts.detailsUrl)}" style="background:#3245FF;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">View reservation</a></p>`
    : "";
  return `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">${heading}: ${a}</h2>
  <p style="color:#555;margin:0 0 16px">${o}</p>
  <p style="color:#333">Hello ${n},</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
    <tr><td style="padding:6px 0;color:#555">Amenity</td><td style="padding:6px 0;text-align:right;color:#333">${a}</td></tr>
    <tr><td style="padding:6px 0;color:#555">Starts</td><td style="padding:6px 0;text-align:right;color:#333">${start}</td></tr>
    <tr><td style="padding:6px 0;color:#555">Ends</td><td style="padding:6px 0;text-align:right;color:#333">${end}</td></tr>
  </table>
  ${permitHtml}
  ${reasonHtml}
  ${noteHtml}
  ${linkHtml}
  <p style="color:#888;font-size:12px;margin-top:24px">This is an automated notice from ${o}.</p>
</div>`;
}

export function buildMeetingNoticeEmail(opts: {
  orgName: string;
  title: string;
  kind: string;
  whenLabel: string;
  location: string | null;
  noticeText: string;
  agendaPacketUrl: string;
}) {
  const orgName = escapeHtml(opts.orgName);
  const title = escapeHtml(opts.title);
  const kindLabel = escapeHtml(opts.kind.charAt(0).toUpperCase() + opts.kind.slice(1));
  const when = escapeHtml(opts.whenLabel);
  const loc = opts.location ? escapeHtml(opts.location) : "";
  const noticeHtml = opts.noticeText
    ? opts.noticeText
        .split("\n")
        .map((l) => `<p style="margin:0 0 12px;color:#333">${escapeHtml(l)}</p>`)
        .join("")
    : "";
  return `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">📅 ${kindLabel} meeting notice — ${title}</h2>
  <p style="color:#555;margin:0 0 16px">${orgName}</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 16px">
    <tr><td style="padding:6px 0;color:#555;width:120px">When</td><td style="padding:6px 0;color:#333"><strong>${when}</strong></td></tr>
    ${loc ? `<tr><td style="padding:6px 0;color:#555">Where</td><td style="padding:6px 0;color:#333">${loc}</td></tr>` : ""}
    <tr><td style="padding:6px 0;color:#555">Type</td><td style="padding:6px 0;color:#333">${kindLabel}</td></tr>
  </table>
  ${noticeHtml}
  <p style="margin:24px 0"><a href="${escapeHtml(opts.agendaPacketUrl)}" style="background:#3245FF;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">View agenda packet</a></p>
  <p style="color:#888;font-size:12px;margin-top:24px">This is an automated notice from ${orgName}.</p>
</div>`;
}

export function buildMinutesAdoptedEmail(opts: {
  orgName: string;
  title: string;
  meetingDateLabel: string;
  adoptedAtLabel: string;
  minutesUrl: string;
}) {
  const orgName = escapeHtml(opts.orgName);
  const title = escapeHtml(opts.title);
  const date = escapeHtml(opts.meetingDateLabel);
  const adopted = escapeHtml(opts.adoptedAtLabel);
  return `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">✅ Minutes adopted — ${title}</h2>
  <p style="color:#555;margin:0 0 16px">${orgName}</p>
  <p style="color:#333">The minutes for the meeting <strong>${title}</strong> held on <strong>${date}</strong> were adopted on <strong>${adopted}</strong>.</p>
  <p style="margin:24px 0"><a href="${escapeHtml(opts.minutesUrl)}" style="background:#3245FF;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">View adopted minutes</a></p>
  <p style="color:#888;font-size:12px;margin-top:24px">This is an automated notice from ${orgName}.</p>
</div>`;
}

// Task #78: ICS-attached email invite. Send the email along with an .ics
// attachment built by buildInviteIcs() in calendarIcal.ts. We use Resend's
// `attachments` field for the .ics payload.
export interface SendInviteEmailOpts {
  to: string;
  subject: string;
  html: string;
  ics: string;
  filename?: string;
}

export async function sendEmailWithIcs(opts: SendInviteEmailOpts): Promise<EmailResult> {
  if (!RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — invite not sent:", opts.subject, "to", opts.to);
    return { ok: true, id: "no-op" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        attachments: [{
          filename: opts.filename ?? "invite.ics",
          content: Buffer.from(opts.ics).toString("base64"),
          contentType: "text/calendar; method=REQUEST; charset=UTF-8",
        }],
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("[email] Resend invite error:", err);
      return { ok: false, error: err };
    }
    const data = (await res.json()) as { id?: string };
    return { ok: true, id: data.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export function buildEventInviteEmail(opts: {
  orgName: string;
  eventTitle: string;
  startsAtLabel: string;
  location: string | null;
  status: "attending" | "waitlisted" | "declined";
  partySize: number;
}) {
  const orgName = escapeHtml(opts.orgName);
  const title = escapeHtml(opts.eventTitle);
  const when = escapeHtml(opts.startsAtLabel);
  const where = opts.location ? `<p style="color:#333;margin:4px 0"><strong>Where:</strong> ${escapeHtml(opts.location)}</p>` : "";
  const headline =
    opts.status === "attending" ? `You're confirmed: ${title}` :
    opts.status === "waitlisted" ? `You're on the waitlist: ${title}` :
    `RSVP cancelled: ${title}`;
  const intro =
    opts.status === "attending" ? `You've RSVP'd <strong>yes</strong> for ${opts.partySize} attendee${opts.partySize === 1 ? "" : "s"}. The event has been added to your calendar.` :
    opts.status === "waitlisted" ? `The event is at capacity, but we've added you to the waitlist. We'll let you know if a spot opens up.` :
    `Your RSVP has been cancelled. If you change your mind, you can RSVP again from the resident portal.`;
  return `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">${headline}</h2>
  <p style="color:#555;margin:0 0 16px">${orgName}</p>
  <p style="color:#333;margin:4px 0"><strong>When:</strong> ${when}</p>
  ${where}
  <p style="color:#333;margin:16px 0">${intro}</p>
  <p style="color:#888;font-size:12px;margin-top:24px">This is an automated notice from ${orgName}.</p>
</div>`;
}

// Task #83: amenity inspection / damage / dispute / deposit / chemistry alerts.
export function buildAmenityInspectionEmail(opts: {
  orgName: string;
  amenityName: string;
  ownerName: string;
  kind: "pre" | "post" | "owner_self";
  status: "scheduled" | "completed" | "flagged";
  startsAt: string;
  flaggedItems?: string[];
  detailsUrl?: string;
}) {
  const o = escapeHtml(opts.orgName);
  const a = escapeHtml(opts.amenityName);
  const n = escapeHtml(opts.ownerName);
  const start = escapeHtml(new Date(opts.startsAt).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" }));
  const kindLabel = opts.kind === "pre" ? "pre-use" : opts.kind === "post" ? "post-use" : "self";
  const heading = opts.status === "flagged"
    ? `Inspection issues found — ${a}`
    : opts.status === "completed"
      ? `Inspection complete — ${a}`
      : `Inspection scheduled — ${a}`;
  const flagged = (opts.flaggedItems ?? []).map((f) => `<li>${escapeHtml(f)}</li>`).join("");
  const flaggedHtml = flagged
    ? `<p style="color:#333;margin-top:12px"><strong>Items flagged:</strong></p><ul style="color:#333">${flagged}</ul>`
    : "";
  const link = opts.detailsUrl
    ? `<p style="margin:24px 0"><a href="${escapeHtml(opts.detailsUrl)}" style="background:#3245FF;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">View inspection</a></p>`
    : "";
  return `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">${heading}</h2>
  <p style="color:#555;margin:0 0 16px">${o}</p>
  <p style="color:#333">Hello ${n},</p>
  <p style="color:#333">A ${escapeHtml(kindLabel)} inspection is associated with your ${a} reservation on <strong>${start}</strong>.</p>
  ${flaggedHtml}
  ${link}
</div>`;
}

export function buildAmenityDamageReportEmail(opts: {
  orgName: string;
  amenityName: string;
  ownerName: string;
  summary: string;
  estimatedCostCents: number;
  status: "filed" | "charged" | "waived" | "resolved";
  managerNotes?: string;
}) {
  const o = escapeHtml(opts.orgName);
  const a = escapeHtml(opts.amenityName);
  const n = escapeHtml(opts.ownerName);
  const s = escapeHtml(opts.summary);
  const dollars = (opts.estimatedCostCents / 100).toFixed(2);
  const heading = opts.status === "filed"
    ? `Damage report filed — ${a}`
    : opts.status === "charged"
      ? `Damage charged to deposit — ${a}`
      : opts.status === "waived"
        ? `Damage report waived — ${a}`
        : `Damage report resolved — ${a}`;
  const note = opts.managerNotes
    ? `<p style="color:#333">Manager note: ${escapeHtml(opts.managerNotes)}</p>`
    : "";
  return `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">${heading}</h2>
  <p style="color:#555;margin:0 0 16px">${o}</p>
  <p style="color:#333">Hello ${n},</p>
  <p style="color:#333"><strong>Summary:</strong> ${s}</p>
  <p style="color:#333"><strong>Estimated cost:</strong> $${dollars}</p>
  ${note}
  <p style="color:#888;font-size:12px;margin-top:24px">If you disagree with this report, you can file a dispute from your resident portal within 14 days.</p>
</div>`;
}

export function buildAmenityDisputeEmail(opts: {
  orgName: string;
  amenityName: string;
  ownerName: string;
  status: "filed" | "responded" | "upheld" | "denied";
  message?: string;
}) {
  const o = escapeHtml(opts.orgName);
  const a = escapeHtml(opts.amenityName);
  const n = escapeHtml(opts.ownerName);
  const heading = opts.status === "filed"
    ? `Dispute filed — ${a}`
    : opts.status === "responded"
      ? `Dispute response posted — ${a}`
      : opts.status === "upheld"
        ? `Dispute upheld — ${a}`
        : `Dispute denied — ${a}`;
  const msg = opts.message
    ? `<blockquote style="border-left:3px solid #ddd;margin:0 0 16px;padding:8px 12px;color:#333;white-space:pre-wrap">${escapeHtml(opts.message)}</blockquote>`
    : "";
  return `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">${heading}</h2>
  <p style="color:#555;margin:0 0 16px">${o}</p>
  <p style="color:#333">Hello ${n},</p>
  ${msg}
</div>`;
}

export function buildPoolChemistryAlertEmail(opts: {
  orgName: string;
  recordedAt: string;
  reasons: string[];
  workOrderId?: string;
}) {
  const o = escapeHtml(opts.orgName);
  const when = escapeHtml(new Date(opts.recordedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }));
  const items = opts.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("");
  const wo = opts.workOrderId
    ? `<p style="color:#333">Work order <strong>${escapeHtml(opts.workOrderId)}</strong> has been opened automatically.</p>`
    : "";
  return `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">⚠️ Pool chemistry out of range</h2>
  <p style="color:#555;margin:0 0 16px">${o}</p>
  <p style="color:#333">A chemistry log recorded at <strong>${when}</strong> is outside acceptable thresholds.</p>
  <ul style="color:#333">${items}</ul>
  ${wo}
</div>`;
}

export function buildVaccinationReminderEmail(opts: {
  orgName: string;
  petName: string;
  vaccineType: string;
  expiresOn: string;
  daysUntil: number;
}) {
  const o = escapeHtml(opts.orgName);
  const n = escapeHtml(opts.petName);
  const v = escapeHtml(opts.vaccineType.toUpperCase());
  const e = escapeHtml(opts.expiresOn);
  const heading = opts.daysUntil <= 0
    ? `Vaccination expired: ${n}`
    : `Vaccination expiring in ${opts.daysUntil} day${opts.daysUntil === 1 ? "" : "s"}: ${n}`;
  const body = opts.daysUntil <= 0
    ? `The <strong>${v}</strong> vaccination for <strong>${n}</strong> expired on ${e}. Dog-park access has been suspended until a current certificate is on file.`
    : `The <strong>${v}</strong> vaccination for <strong>${n}</strong> expires on ${e}. Please upload an updated certificate to maintain dog-park access.`;
  return `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">${heading}</h2>
  <p style="color:#555;margin:0 0 16px">${o}</p>
  <p style="color:#333">${body}</p>
  <p style="color:#888;font-size:12px;margin-top:24px">This is an automated notice from ${o}.</p>
</div>`;
}

export function buildPetSuspensionEmail(opts: {
  orgName: string;
  unitId: string;
  reason: string;
}) {
  const o = escapeHtml(opts.orgName);
  const u = escapeHtml(opts.unitId);
  const r = escapeHtml(opts.reason);
  return `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">Dog-park access suspended — Unit ${u}</h2>
  <p style="color:#555;margin:0 0 16px">${o}</p>
  <p style="color:#333">Dog-park access for your unit has been suspended.</p>
  <p style="color:#333"><strong>Reason:</strong> ${r}</p>
  <p style="color:#333">Resolve the issue (update vaccinations, sign the park-rules agreement, or contact the manager) to restore access.</p>
  <p style="color:#888;font-size:12px;margin-top:24px">This is an automated notice from ${o}.</p>
</div>`;
}

export function buildPetIncidentEmail(opts: {
  orgName: string;
  petName: string;
  kind: string;
  severity: string;
  occurredAt: string;
  description: string;
}) {
  const o = escapeHtml(opts.orgName);
  const n = escapeHtml(opts.petName);
  const k = escapeHtml(opts.kind);
  const s = escapeHtml(opts.severity);
  const t = escapeHtml(new Date(opts.occurredAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }));
  const d = escapeHtml(opts.description || "(no details provided)");
  return `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">Pet incident reported — ${n}</h2>
  <p style="color:#555;margin:0 0 16px">${o}</p>
  <p style="color:#333"><strong>Type:</strong> ${k} (${s})</p>
  <p style="color:#333"><strong>When:</strong> ${t}</p>
  <p style="color:#333"><strong>Details:</strong> ${d}</p>
  <p style="color:#333">A manager will follow up. Repeated incidents may result in suspension of dog-park access.</p>
  <p style="color:#888;font-size:12px;margin-top:24px">This is an automated notice from ${o}.</p>
</div>`;
}

export function buildBroadcastEmail(opts: {
  orgName: string;
  subject: string;
  body: string;
}) {
  const bodyHtml = opts.body
    .split("\n")
    .map((l) => `<p style="margin:0 0 12px;color:#333">${l}</p>`)
    .join("");
  return `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">${opts.subject}</h2>
  <p style="color:#888;font-size:13px;margin:0 0 20px">From ${opts.orgName}</p>
  ${bodyHtml}
</div>`;
}
