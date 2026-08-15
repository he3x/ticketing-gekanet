/**
 * services/wa-notify.ts
 * ─────────────────────
 * Singleton holder for the whatsapp-web.js client.
 * Provides fire-and-forget notification helpers for ticket events.
 *
 * Usage:
 *   server.ts  → call setWAClient(waClient) inside the "ready" event
 *              → call setWAClient(null)      inside the "disconnected" event
 *   tickets.ts → import { sendNewTicketNotification, sendTicketClosedNotification }
 */

// @ts-ignore – database.js has no TS declarations
import db from "../database.js";

// ═════════════════════════════════════════════════════════════════════════════
// SINGLETON CLIENT
// ═════════════════════════════════════════════════════════════════════════════

let _client: any = null;

/**
 * Called by server.ts after the WA client fires its "ready" event.
 */
export function setWAClient(client: any): void {
  _client = client;
}

/**
 * Returns the current WA client instance (null when disconnected).
 */
export function getWAClient(): any {
  return _client;
}

// ═════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Read a single setting value from the `settings` table (key-value rows).
 */
async function getSetting(key: string): Promise<string> {
  try {
    const rows = await db.query(
      `SELECT value FROM settings WHERE key = $1`,
      [key]
    );
    return rows[0]?.value ?? "";
  } catch {
    return "";
  }
}

/**
 * Resolve user IDs → display names.
 */
async function resolveNames(userIds: (string | number)[]): Promise<string[]> {
  if (!userIds.length) return [];
  
  try {
    const placeholders = userIds.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await db.query(
      `SELECT name FROM users WHERE id IN (${placeholders})`,
      userIds
    );
    return rows.map((r: any) => r.name as string);
  } catch {
    return [];
  }
}

/**
 * Low-level send — mirrors the sendWhatsApp() pattern in server.ts.
 */
async function send(groupId: string, message: string): Promise<void> {
  if (!_client) {
    console.log("[WA-notify] Client not connected — skipping send.");
    return;
  }
  
  const chatId = groupId.includes("@") ? groupId : `${groupId}@g.us`;
  await _client.sendMessage(chatId, message);
}

/**
 * Build ticket link using APP_URL from environment or fallback to localhost.
 */
function buildTicketLink(ticketId: string | number): string {
  const baseUrl = process.env.APP_URL || "http://localhost:3000";
  return `${baseUrl}/?ticketId=${ticketId}`;
}

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC NOTIFICATION HELPERS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * sendNewTicketNotification
 * 
 * Fires after POST /api/v1/tickets successfully creates a ticket.
 * Never throws — errors are logged and swallowed so ticket creation is
 * never blocked by a WA delivery failure.
 * 
 * @param ticket - Ticket data including id, type, customer info, etc.
 * @param technicianIds - Array of technician user IDs assigned to this ticket
 */
export async function sendNewTicketNotification(
  ticket: {
    id: string | number;
    external_id?: string | number;
    type: string;
    customer_name: string;
    address: string;
    package_name?: string | null;
    issue?: string | null;
    location_url?: string | null;
    notes?: string | null;
  },
  technicianIds: (string | number)[]
): Promise<void> {
  if (!_client) return;

  try {
    // Get WhatsApp group ID from settings
    const groupId = await getSetting("whatsapp_group");
    if (!groupId) return;

    // Pick the right template based on ticket type
    let templateKey = "template_maintenance";
    if (ticket.type === "installation") {
      templateKey = "template_installation";
    } else if (ticket.type === "dismantle") {
      templateKey = "template_dismantle";
    }

    const template = await getSetting(templateKey);
    if (!template) return;

    // Build substitution values
    const detail =
      ticket.type === "installation"
        ? (ticket.package_name ?? "-")
        : (ticket.issue ?? "-");

    const names = await resolveNames(technicianIds);
    const technicianStr = names.length 
      ? `\nTeknisi: ${names.join(", ")}` 
      : "";
    
    const locationStr = ticket.location_url 
      ? `\nLokasi: ${ticket.location_url}` 
      : "";
    
    // Use external_id (human-readable) in the link so it matches the displayed ID
    const ticketLink = buildTicketLink(ticket.external_id ?? ticket.id);

    // Replace template variables
    const message = template
      .replace("{id}", String(ticket.external_id ?? ticket.id))
      .replace("{customerName}", ticket.customer_name)
      .replace("{address}", ticket.address)
      .replace("{detail}", detail)
      .replace("{technician}", technicianStr)
      .replace("{location}", locationStr)
      .replace("{link}", ticketLink);

    await send(groupId, message);
    
    console.log(
      `[WA-notify] New-ticket notification sent for #${ticket.external_id ?? ticket.id}`
    );
  } catch (err) {
    console.error("[WA-notify] sendNewTicketNotification failed:", err);
  }
}

/**
 * sendTicketClosedNotification
 * 
 * Fires when PATCH /api/v1/tickets/:id sets status → "completed".
 * Never throws.
 * 
 * @param ticket - Ticket data including id, customer info, report, etc.
 * @param technicianIds - Array of technician user IDs who worked on this ticket
 */
export async function sendTicketClosedNotification(
  ticket: {
    id: string | number;
    external_id?: string | number;
    customer_name: string;
    report?: string | null;
    location_url?: string | null;
  },
  technicianIds: (string | number)[]
): Promise<void> {
  if (!_client) return;

  try {
    // Get WhatsApp group ID from settings
    const groupId = await getSetting("whatsapp_group");
    if (!groupId) return;

    const template = await getSetting("template_closed");
    if (!template) return;

    // Build substitution values
    const names = await resolveNames(technicianIds);
    const technicianStr = names.join(", ");
    
    const locationStr = ticket.location_url 
      ? `\nLokasi: ${ticket.location_url}` 
      : "";
    
    // Use external_id (human-readable) in the link so it matches the displayed ID
    const ticketLink = buildTicketLink(ticket.external_id ?? ticket.id);

    // Replace template variables
    const message = template
      .replace("{id}", String(ticket.external_id ?? ticket.id))
      .replace("{customerName}", ticket.customer_name)
      .replace("{technician}", technicianStr)
      .replace("{report}", ticket.report ?? "-")
      .replace("{location}", locationStr)
      .replace("{link}", ticketLink);

    await send(groupId, message);
    
    console.log(
      `[WA-notify] Closed notification sent for #${ticket.external_id ?? ticket.id}`
    );
  } catch (err) {
    console.error("[WA-notify] sendTicketClosedNotification failed:", err);
  }
}