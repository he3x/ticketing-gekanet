/**
 * Test script to simulate reminder message generation
 */

import fs from 'fs';
import path from 'path';

const DB_FILE = path.join(process.cwd(), 'db.json');

function formatMessage(template, ticket, db, origin) {
  const typeLabel = ticket.type === "maintenance" ? "Maintenance" : ticket.type === "dismantle" ? "Dismantle / Pelepasan" : "Pemasangan Baru";
  const detailLabel = ticket.type === "maintenance" ? `Kendala: ${ticket.issue}` : ticket.type === "dismantle" ? `Alasan: ${ticket.issue}` : `Paket: ${ticket.package}`;
  const locationMsg = ticket.locationUrl ? `\nLokasi: ${ticket.locationUrl}` : "";
  
  const displayId = ticket.displayId || ticket.id;
  // Link now uses displayId to match the displayed ID
  const ticketLink = origin ? `\nLink Tiket: ${origin}/?ticketId=${displayId}` : "";
  
  let techNames = "";
  if (ticket.technicianId) {
    const mainTech = db.users.find(u => u.id === ticket.technicianId);
    if (mainTech) techNames = mainTech.name;
  }
  if (ticket.assignedTechnicianIds && ticket.assignedTechnicianIds.length > 0) {
    const otherTechs = db.users
      .filter(u => ticket.assignedTechnicianIds.includes(u.id))
      .map(u => u.name);
    if (techNames) {
      techNames = `${techNames}, ${otherTechs.join(", ")}`;
    } else {
      techNames = otherTechs.join(", ");
    }
  }

  return template
    .replace(/{type}/g, typeLabel)
    .replace(/{id}/g, String(displayId))
    .replace(/{customerName}/g, ticket.customerName || "")
    .replace(/{address}/g, ticket.address || "")
    .replace(/{detail}/g, detailLabel)
    .replace(/{location}/g, locationMsg)
    .replace(/{report}/g, ticket.report || "")
    .replace(/{notes}/g, ticket.technicianNotes || "")
    .replace(/{phone}/g, ticket.phone || "")
    .replace(/{technician}/g, techNames)
    .replace(/{link}/g, ticketLink);
}

function testReminderMessage() {
  console.log('Testing Reminder Message Format...\n');
  
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  
  // Get the last ticket (should be #7 based on migration)
  const ticket = db.tickets[db.tickets.length - 1];
  
  console.log(`Testing with Ticket #${ticket.displayId}:`);
  console.log(`  - ID (internal): ${ticket.id}`);
  console.log(`  - displayId: ${ticket.displayId}`);
  console.log(`  - Customer: ${ticket.customerName}`);
  console.log(`  - Type: ${ticket.type}\n`);
  
  const template = ticket.type === "maintenance"
    ? (db.settings.templateMaintenance || "Tiket Maintenance Baru!\nID: {id}\nPelanggan: {customerName}\nAlamat: {address}\nKendala: {detail}\nTeknisi: {technician}{location}{link}")
    : ticket.type === "dismantle"
    ? (db.settings.templateDismantle || "Tiket Dismantle Baru!\nID: {id}\nPelanggan: {customerName}\nAlamat: {address}\nAlasan: {detail}\nTeknisi: {technician}{location}{link}")
    : (db.settings.templateInstallation || "Tiket Pemasangan Baru!\nID: {id}\nPelanggan: {customerName}\nAlamat: {address}\nPaket: {detail}\nTeknisi: {technician}{location}{link}");
  
  const message = formatMessage(template, ticket, db, "http://localhost:3000");
  const reminderMessage = `[REMINDER] ${message}`;
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log('NORMAL MESSAGE:');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(message);
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('REMINDER MESSAGE:');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(reminderMessage);
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // Verify key points
  const hasReminderTag = reminderMessage.startsWith('[REMINDER]');
  const hasDisplayId = reminderMessage.includes(`ID: ${ticket.displayId}`);
  // Now the link should use displayId, not internal id
  const linkHasDisplayId = reminderMessage.includes(`ticketId=${ticket.displayId}`);
  const linkDoesNotHaveInternalId = !reminderMessage.includes(`ticketId=${ticket.id}`);
  
  console.log('Verification:');
  console.log(`  ✓ Has [REMINDER] tag: ${hasReminderTag ? '✅' : '❌'}`);
  console.log(`  ✓ Shows displayId (#${ticket.displayId}) in message: ${hasDisplayId ? '✅' : '❌'}`);
  console.log(`  ✓ Link uses displayId (#${ticket.displayId}): ${linkHasDisplayId ? '✅' : '❌'}`);
  console.log(`  ✓ Link does NOT use internal ID: ${linkDoesNotHaveInternalId ? '✅' : '❌'}`);
  
  const linkMatch = reminderMessage.match(/ticketId=(\d+)/);
  if (linkMatch) {
    console.log(`\n  Link analysis:`);
    console.log(`    - Link ticketId: ${linkMatch[1]}`);
    console.log(`    - Displayed ID: ${ticket.displayId}`);
    console.log(`    - They match: ${linkMatch[1] === String(ticket.displayId) ? '✅ YES' : '❌ NO'}`);
  }
  
  if (hasReminderTag && hasDisplayId && linkHasDisplayId) {
    console.log('\n✅ All tests passed! Message ID and Link ID now match.');
    console.log('\nSummary:');
    console.log(`  - User sees: ID: ${ticket.displayId}`);
    console.log(`  - Link contains: ticketId=${ticket.displayId}  ← now matches!`);
    console.log(`  - Reminder has: [REMINDER] prefix`);
  } else {
    console.log('\n❌ Some tests failed!');
  }
}

try {
  testReminderMessage();
} catch (error) {
  console.error('Test failed:', error);
  process.exit(1);
}
