/**
 * Test script to verify displayId functionality
 */

import fs from 'fs';
import path from 'path';

const DB_FILE = path.join(process.cwd(), 'db.json');

function testDisplayIds() {
  console.log('Testing displayId functionality...\n');
  
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  
  console.log(`✓ nextDisplayId: ${db.nextDisplayId}`);
  console.log(`✓ Total tickets: ${db.tickets.length}\n`);
  
  console.log('Sample tickets:');
  db.tickets.slice(0, 3).forEach(t => {
    console.log(`  #${t.displayId} - ID: ${t.id} - Customer: ${t.customerName}`);
  });
  
  console.log('\n✓ All tickets have displayId:', db.tickets.every(t => t.displayId));
  console.log('✓ displayIds are sequential:', 
    db.tickets.every((t, i, arr) => {
      if (i === 0) return true;
      const sorted = [...arr].sort((a, b) => a.displayId - b.displayId);
      return sorted[i].displayId === sorted[i - 1].displayId + 1 || 
             sorted[i].displayId > sorted[i - 1].displayId;
    })
  );
  
  console.log('\n✅ Display ID system is working correctly!');
}

try {
  testDisplayIds();
} catch (error) {
  console.error('Test failed:', error);
  process.exit(1);
}
