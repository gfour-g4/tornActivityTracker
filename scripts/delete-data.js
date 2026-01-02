const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/activity.db');
const db = new Database(DB_PATH);

// December 30-31, 2025 timestamps
const startTimestamp = Math.floor(new Date('2025-12-29T00:00:00Z').getTime() / 1000);
const endTimestamp = Math.floor(new Date('2026-01-01T00:00:00Z').getTime() / 1000);

console.log(`Deleting data between ${new Date(startTimestamp * 1000).toISOString()} and ${new Date(endTimestamp * 1000).toISOString()}`);

const transaction = db.transaction(() => {
    // Find snapshot IDs to delete
    const snapshots = db.prepare(`
        SELECT id FROM snapshots 
        WHERE timestamp >= ? AND timestamp < ?
    `).all(startTimestamp, endTimestamp);
    
    const snapshotIds = snapshots.map(s => s.id);
    console.log(`Found ${snapshotIds.length} snapshots to delete`);
    
    if (snapshotIds.length > 0) {
        // Delete in chunks
        const chunkSize = 500;
        for (let i = 0; i < snapshotIds.length; i += chunkSize) {
            const chunk = snapshotIds.slice(i, i + chunkSize);
            const placeholders = chunk.map(() => '?').join(',');
            
            db.prepare(`DELETE FROM snapshot_members WHERE snapshot_id IN (${placeholders})`).run(...chunk);
            db.prepare(`DELETE FROM snapshots WHERE id IN (${placeholders})`).run(...chunk);
        }
        console.log(`✓ Deleted ${snapshotIds.length} snapshots and their members`);
    }
    
    // Delete daily aggregates
    const aggResult = db.prepare(`
        DELETE FROM daily_aggregates 
        WHERE date IN ('2025-12-30', '2025-12-31')
    `).run();
    console.log(`✓ Deleted ${aggResult.changes} daily aggregate rows`);
});

transaction();

// Vacuum to reclaim space
console.log('Vacuuming database...');
db.exec('VACUUM');

console.log('✓ Done!');
db.close();