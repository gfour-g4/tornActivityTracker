/**
 * Migration script: JSON files -> SQLite
 * Run with: npm run migrate
 */

const fs = require('fs');
const path = require('path');
const db = require('../database');
const { dbLog } = require('./logger');

const DATA_DIR = path.join(__dirname, '../../data');

async function migrate() {
    console.log('Starting migration from JSON to SQLite...\n');
    
    // Initialize database
    db.getDb();
    dbLog.info('Database initialized');
    
    // Find all faction JSON files
    const files = fs.readdirSync(DATA_DIR).filter(f => 
        f.startsWith('faction_') && f.endsWith('.json')
    );
    
    console.log(`Found ${files.length} faction files to migrate\n`);
    
    let totalSnapshots = 0;
    let totalMembers = new Set();
    
    for (const file of files) {
        const match = file.match(/faction_(\d+)\.json/);
        if (!match) continue;
        
        const factionId = parseInt(match[1]);
        const filePath = path.join(DATA_DIR, file);
        
        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            
            console.log(`Migrating: ${data.name || file}`);
            console.log(`  Snapshots: ${data.snapshots?.length || 0}`);
            
            // Insert faction
            db.upsertFaction(factionId, data.name);
            
            // Insert snapshots
            const snapshots = data.snapshots || [];
            let migrated = 0;
            
            for (const snapshot of snapshots) {
                const timestamp = snapshot.t || snapshot.timestamp;
                const active = snapshot.a || snapshot.active || [];
                const total = snapshot.n || snapshot.total || 0;
                
                db.addSnapshot(factionId, data.name, timestamp, active, total);
                
                active.forEach(id => totalMembers.add(id));
                migrated++;
            }
            
            totalSnapshots += migrated;
            console.log(`  ✓ Migrated ${migrated} snapshots\n`);
            
        } catch (error) {
            console.error(`  ✗ Error: ${error.message}\n`);
        }
    }
    
    // Migrate member names
    const namesPath = path.join(DATA_DIR, 'member_names.json');
    if (fs.existsSync(namesPath)) {
        console.log('Migrating member names...');
        try {
            const names = JSON.parse(fs.readFileSync(namesPath, 'utf8'));
            let nameCount = 0;
            
            for (const [id, name] of Object.entries(names)) {
                db.upsertMember(parseInt(id), name);
                nameCount++;
            }
            
            console.log(`  ✓ Migrated ${nameCount} member names\n`);
        } catch (error) {
            console.error(`  ✗ Error: ${error.message}\n`);
        }
    }
    
    // Print stats
    const stats = db.getDbStats();
    console.log('=== Migration Complete ===\n');
    console.log(`Factions: ${stats.factions}`);
    console.log(`Snapshots: ${stats.snapshots}`);
    console.log(`Members: ${stats.members}`);
    console.log(`Aggregates: ${stats.aggregates}`);
    console.log(`Database size: ${(stats.dbSize / 1024 / 1024).toFixed(2)} MB`);
    
    console.log('\n=== Cleanup ===\n');
    console.log('You can now delete the old JSON files:');
    console.log(`  rm ${DATA_DIR}/faction_*.json`);
    console.log(`  rm ${DATA_DIR}/member_names.json`);
    console.log(`  rm ${DATA_DIR}/user_index.json`);
    
    db.closeDb();
}

migrate().catch(console.error);