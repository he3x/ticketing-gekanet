/**
 * Migration script to add displayId to existing tickets
 * Run this once: node migrate-display-id.js
 */

import fs from 'fs';
import path from 'path';

const DB_FILE = path.join(process.cwd(), 'db.json');

function migrateDisplayIds() {
  console.log('Starting displayId migration...');
  
  // Read database
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  
  // Check if migration is needed
  const needsMigration = db.tickets.some(t => !t.displayId);
  
  if (!needsMigration && db.nextDisplayId) {
    console.log('✓ All tickets already have displayId. No migration needed.');
    return;
  }
  
  // Sort tickets by creation date to assign sequential IDs
  const sortedTickets = [...db.tickets].sort((a, b) => {
    const dateA = new Date(a.createdAt || a.id);
    const dateB = new Date(b.createdAt || b.id);
    return dateA - dateB;
  });
  
  let displayIdCounter = 1;
  const updatedTickets = [];
  
  // Assign displayId to each ticket
  for (const ticket of sortedTickets) {
    if (!ticket.displayId) {
      ticket.displayId = displayIdCounter++;
      console.log(`  Ticket ${ticket.id} → displayId: ${ticket.displayId}`);
    } else {
      // Keep existing displayId and update counter
      if (ticket.displayId >= displayIdCounter) {
        displayIdCounter = ticket.displayId + 1;
      }
    }
    updatedTickets.push(ticket);
  }
  
  // Update database
  db.tickets = updatedTickets;
  db.nextDisplayId = displayIdCounter;
  
  // Backup original file
  const backupFile = DB_FILE + '.backup.' + Date.now();
  fs.copyFileSync(DB_FILE, backupFile);
  console.log(`\n✓ Backup created: ${backupFile}`);
  
  // Save updated database
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  console.log(`✓ Migration complete! Updated ${updatedTickets.length} tickets.`);
  console.log(`✓ Next displayId will be: ${db.nextDisplayId}`);
}

try {
  migrateDisplayIds();
} catch (error) {
  console.error('Migration failed:', error);
  process.exit(1);
}
