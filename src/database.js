const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../data');
const DB_PATH = path.join(DATA_DIR, 'activity.db');

let db = null;

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function getDb() {
    if (db) return db;
    
    ensureDataDir();
    
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -64000'); // 64MB cache
    
    initializeSchema();
    
    return db;
}

function initializeSchema() {
    db.exec(`
        -- Factions table
        CREATE TABLE IF NOT EXISTS factions (
            id INTEGER PRIMARY KEY,
            name TEXT,
            last_updated INTEGER DEFAULT 0
        );
        
        -- Snapshots table (one row per collection)
        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            faction_id INTEGER NOT NULL,
            timestamp INTEGER NOT NULL,
            active_count INTEGER NOT NULL,
            total_count INTEGER NOT NULL,
            FOREIGN KEY (faction_id) REFERENCES factions(id)
        );
        
        -- Active members per snapshot (normalized)
        CREATE TABLE IF NOT EXISTS snapshot_members (
            snapshot_id INTEGER NOT NULL,
            member_id INTEGER NOT NULL,
            PRIMARY KEY (snapshot_id, member_id),
            FOREIGN KEY (snapshot_id) REFERENCES snapshots(id)
        );
        
        -- Member names
        CREATE TABLE IF NOT EXISTS members (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            last_seen INTEGER DEFAULT 0
        );
        
        -- User to faction mapping (for quick lookups)
        CREATE TABLE IF NOT EXISTS member_factions (
            member_id INTEGER NOT NULL,
            faction_id INTEGER NOT NULL,
            first_seen INTEGER NOT NULL,
            last_seen INTEGER NOT NULL,
            PRIMARY KEY (member_id, faction_id)
        );
        
        -- Pre-aggregated daily data (for faster heatmap generation)
        CREATE TABLE IF NOT EXISTS daily_aggregates (
            faction_id INTEGER NOT NULL,
            date TEXT NOT NULL, -- YYYY-MM-DD
            hour INTEGER NOT NULL, -- 0-23
            day_of_week INTEGER NOT NULL, -- 0-6 (Sun-Sat)
            slot INTEGER NOT NULL DEFAULT 0, -- 0-3 for 15-min slots, 0 for hourly
            unique_active INTEGER NOT NULL,
            snapshot_count INTEGER NOT NULL,
            PRIMARY KEY (faction_id, date, hour, slot)
        );
        
        -- Indexes for common queries
        CREATE INDEX IF NOT EXISTS idx_snapshots_faction_time 
            ON snapshots(faction_id, timestamp DESC);
        
        CREATE INDEX IF NOT EXISTS idx_snapshot_members_member 
            ON snapshot_members(member_id);
        
        CREATE INDEX IF NOT EXISTS idx_member_factions_member 
            ON member_factions(member_id);
        
        CREATE INDEX IF NOT EXISTS idx_daily_agg_faction 
            ON daily_aggregates(faction_id, date DESC);
        
        CREATE INDEX IF NOT EXISTS idx_daily_agg_lookup 
            ON daily_aggregates(faction_id, day_of_week, hour, slot);
    `);
}

function closeDb() {
    if (db) {
        db.close();
        db = null;
    }
}

// ============================================
// FACTION OPERATIONS
// ============================================

function upsertFaction(factionId, name) {
    const stmt = getDb().prepare(`
        INSERT INTO factions (id, name, last_updated)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            last_updated = excluded.last_updated
    `);
    
    stmt.run(factionId, name, Math.floor(Date.now() / 1000));
}

function getFaction(factionId) {
    return getDb().prepare('SELECT * FROM factions WHERE id = ?').get(factionId);
}

function getAllFactions() {
    return getDb().prepare('SELECT * FROM factions ORDER BY name').all();
}

// ============================================
// SNAPSHOT OPERATIONS
// ============================================

function addSnapshot(factionId, factionName, timestamp, activeMembers, totalCount) {
    const db = getDb();
    
    const insertSnapshot = db.prepare(`
        INSERT INTO snapshots (faction_id, timestamp, active_count, total_count)
        VALUES (?, ?, ?, ?)
    `);
    
    const insertMember = db.prepare(`
        INSERT OR IGNORE INTO snapshot_members (snapshot_id, member_id)
        VALUES (?, ?)
    `);
    
    const updateMemberFaction = db.prepare(`
        INSERT INTO member_factions (member_id, faction_id, first_seen, last_seen)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(member_id, faction_id) DO UPDATE SET
            last_seen = excluded.last_seen
    `);
    
    const transaction = db.transaction(() => {
        // Upsert faction
        upsertFaction(factionId, factionName);
        
        // Insert snapshot
        const result = insertSnapshot.run(factionId, timestamp, activeMembers.length, totalCount);
        const snapshotId = result.lastInsertRowid;
        
        // Insert active members
        for (const memberId of activeMembers) {
            insertMember.run(snapshotId, memberId);
            updateMemberFaction.run(memberId, factionId, timestamp, timestamp);
        }
        
        // Update daily aggregate
        updateDailyAggregate(factionId, timestamp, activeMembers);
        
        return snapshotId;
    });
    
    return transaction();
}

function updateDailyAggregate(factionId, timestamp, activeMembers) {
    const date = new Date(timestamp * 1000);
    const dateStr = date.toISOString().split('T')[0];
    const hour = date.getUTCHours();
    const dayOfWeek = date.getUTCDay();
    const slot = Math.floor(date.getUTCMinutes() / 15);
    
    const db = getDb();
    
    // Get existing aggregate
    const existing = db.prepare(`
        SELECT unique_active, snapshot_count FROM daily_aggregates
        WHERE faction_id = ? AND date = ? AND hour = ? AND slot = ?
    `).get(factionId, dateStr, hour, slot);
    
    if (existing) {
        // Update - we store cumulative unique count, so just increment snapshot_count
        // For true unique, we'd need to store member sets, but this is a good approximation
        db.prepare(`
            UPDATE daily_aggregates
            SET unique_active = unique_active + ?,
                snapshot_count = snapshot_count + 1
            WHERE faction_id = ? AND date = ? AND hour = ? AND slot = ?
        `).run(activeMembers.length, factionId, dateStr, hour, slot);
    } else {
        // Insert new
        db.prepare(`
            INSERT INTO daily_aggregates (faction_id, date, hour, day_of_week, slot, unique_active, snapshot_count)
            VALUES (?, ?, ?, ?, ?, ?, 1)
        `).run(factionId, dateStr, hour, dayOfWeek, slot, activeMembers.length);
    }
}

function getSnapshots(factionId, since = 0) {
    return getDb().prepare(`
        SELECT s.*, GROUP_CONCAT(sm.member_id) as active_members
        FROM snapshots s
        LEFT JOIN snapshot_members sm ON s.id = sm.snapshot_id
        WHERE s.faction_id = ? AND s.timestamp >= ?
        GROUP BY s.id
        ORDER BY s.timestamp ASC
    `).all(factionId, since);
}

function getSnapshotsNormalized(factionId, since = 0) {
    const rows = getSnapshots(factionId, since);
    
    return rows.map(row => ({
        timestamp: row.timestamp,
        active: row.active_members ? row.active_members.split(',').map(Number) : [],
        total: row.total_count
    }));
}

function getLatestSnapshot(factionId) {
    const row = getDb().prepare(`
        SELECT s.*, GROUP_CONCAT(sm.member_id) as active_members
        FROM snapshots s
        LEFT JOIN snapshot_members sm ON s.id = sm.snapshot_id
        WHERE s.faction_id = ?
        GROUP BY s.id
        ORDER BY s.timestamp DESC
        LIMIT 1
    `).get(factionId);
    
    if (!row) return null;
    
    return {
        timestamp: row.timestamp,
        active: row.active_members ? row.active_members.split(',').map(Number) : [],
        total: row.total_count
    };
}

function getSnapshotCount(factionId) {
    const row = getDb().prepare('SELECT COUNT(*) as count FROM snapshots WHERE faction_id = ?').get(factionId);
    return row ? row.count : 0;
}

function pruneOldData(daysToKeep = 30) {
    const cutoff = Math.floor(Date.now() / 1000) - (daysToKeep * 24 * 60 * 60);
    const db = getDb();
    
    const transaction = db.transaction(() => {
        // Get snapshot IDs to delete
        const snapshots = db.prepare('SELECT id FROM snapshots WHERE timestamp < ?').all(cutoff);
        const snapshotIds = snapshots.map(s => s.id);
        
        if (snapshotIds.length === 0) return 0;
        
        // Delete snapshot members
        const placeholders = snapshotIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM snapshot_members WHERE snapshot_id IN (${placeholders})`).run(...snapshotIds);
        
        // Delete snapshots
        db.prepare(`DELETE FROM snapshots WHERE id IN (${placeholders})`).run(...snapshotIds);
        
        // Delete old aggregates
        const cutoffDate = new Date(cutoff * 1000).toISOString().split('T')[0];
        db.prepare('DELETE FROM daily_aggregates WHERE date < ?').run(cutoffDate);
        
        return snapshotIds.length;
    });
    
    return transaction();
}

// ============================================
// MEMBER OPERATIONS
// ============================================

function upsertMember(memberId, name) {
    getDb().prepare(`
        INSERT INTO members (id, name, last_seen)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            last_seen = excluded.last_seen
    `).run(memberId, name, Math.floor(Date.now() / 1000));
}

function upsertMembers(members) {
    const stmt = getDb().prepare(`
        INSERT INTO members (id, name, last_seen)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            last_seen = excluded.last_seen
    `);
    
    const now = Math.floor(Date.now() / 1000);
    const transaction = getDb().transaction(() => {
        for (const [id, data] of Object.entries(members)) {
            if (data.name) {
                stmt.run(parseInt(id), data.name, now);
            }
        }
    });
    
    transaction();
}

function getMemberName(memberId) {
    const row = getDb().prepare('SELECT name FROM members WHERE id = ?').get(memberId);
    return row ? row.name : null;
}

function searchMembers(query, limit = 25) {
    const q = `%${query}%`;
    return getDb().prepare(`
        SELECT id, name FROM members
        WHERE name LIKE ? OR CAST(id AS TEXT) LIKE ?
        ORDER BY 
            CASE 
                WHEN LOWER(name) = LOWER(?) THEN 0
                WHEN LOWER(name) LIKE LOWER(?) THEN 1
                ELSE 2
            END,
            name
        LIMIT ?
    `).all(q, q, query, query + '%', limit);
}

function getMemberFactions(memberId) {
    return getDb().prepare(`
        SELECT faction_id FROM member_factions
        WHERE member_id = ?
        ORDER BY last_seen DESC
    `).all(memberId).map(r => r.faction_id);
}

// ============================================
// AGGREGATION QUERIES (FAST)
// ============================================

function getHourlyAggregates(factionId, daysBack = 30) {
    const cutoffDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    return getDb().prepare(`
        SELECT 
            day_of_week,
            hour,
            SUM(unique_active) as total_active,
            SUM(snapshot_count) as total_snapshots
        FROM daily_aggregates
        WHERE faction_id = ? AND date >= ?
        GROUP BY day_of_week, hour
        ORDER BY day_of_week, hour
    `).all(factionId, cutoffDate);
}

function get15MinAggregates(factionId, daysBack = 30) {
    const cutoffDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    return getDb().prepare(`
        SELECT 
            day_of_week,
            hour,
            slot,
            SUM(unique_active) as total_active,
            SUM(snapshot_count) as total_snapshots
        FROM daily_aggregates
        WHERE faction_id = ? AND date >= ?
        GROUP BY day_of_week, hour, slot
        ORDER BY day_of_week, hour, slot
    `).all(factionId, cutoffDate);
}

function getWeekCount(factionId, daysBack = 30) {
    const cutoffDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const row = getDb().prepare(`
        SELECT COUNT(DISTINCT strftime('%Y-%W', date)) as weeks
        FROM daily_aggregates
        WHERE faction_id = ? AND date >= ?
    `).get(factionId, cutoffDate);
    
    return row ? row.weeks : 0;
}

// ============================================
// ACTIVITY CHECKING (for smart collection)
// ============================================

function getRecentActivityLevel(factionId, hours = 6) {
    const since = Math.floor(Date.now() / 1000) - (hours * 3600);
    
    const row = getDb().prepare(`
        SELECT 
            COUNT(*) as snapshots,
            SUM(active_count) as total_active,
            MAX(active_count) as max_active
        FROM snapshots
        WHERE faction_id = ? AND timestamp >= ?
    `).get(factionId, since);
    
    return row || { snapshots: 0, total_active: 0, max_active: 0 };
}

function isInactiveFaction(factionId) {
    const activity = getRecentActivityLevel(factionId, 24);
    
    // Inactive if less than 5% activity over 24 hours
    if (activity.snapshots === 0) return false; // New faction, always collect
    
    const avgActive = activity.total_active / activity.snapshots;
    const faction = getFaction(factionId);
    
    if (!faction) return false;
    
    // Consider inactive if average active < 2 members over 24h
    return avgActive < 2 && activity.max_active < 5;
}

// ============================================
// STATS
// ============================================

function getDbStats() {
    const db = getDb();
    
    return {
        factions: db.prepare('SELECT COUNT(*) as count FROM factions').get().count,
        snapshots: db.prepare('SELECT COUNT(*) as count FROM snapshots').get().count,
        members: db.prepare('SELECT COUNT(*) as count FROM members').get().count,
        aggregates: db.prepare('SELECT COUNT(*) as count FROM daily_aggregates').get().count,
        dbSize: fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0
    };
}

module.exports = {
    getDb,
    closeDb,
    initializeSchema,
    
    // Factions
    upsertFaction,
    getFaction,
    getAllFactions,
    
    // Snapshots
    addSnapshot,
    getSnapshots,
    getSnapshotsNormalized,
    getLatestSnapshot,
    getSnapshotCount,
    pruneOldData,
    
    // Members
    upsertMember,
    upsertMembers,
    getMemberName,
    searchMembers,
    getMemberFactions,
    
    // Aggregates
    getHourlyAggregates,
    get15MinAggregates,
    getWeekCount,
    
    // Activity
    getRecentActivityLevel,
    isInactiveFaction,
    
    // Stats
    getDbStats
};