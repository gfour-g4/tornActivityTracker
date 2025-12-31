const fs = require('fs');
const path = require('path');
const db = require('../database');
const { memberCache } = require('./cache');

const CONFIG_PATH = path.join(__dirname, '../../config.json');
const DATA_DIR = path.join(__dirname, '../../data');

// Config cache
let configCache = null;
let configMtime = 0;

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

// ============================================
// CONFIG
// ============================================

function loadConfig() {
    try {
        const stats = fs.statSync(CONFIG_PATH);
        if (configCache && configMtime === stats.mtimeMs) {
            return configCache;
        }
        
        const data = fs.readFileSync(CONFIG_PATH, 'utf8');
        configCache = JSON.parse(data);
        configMtime = stats.mtimeMs;
        return configCache;
    } catch (error) {
        return { factions: [], apikeys: [], currentKeyIndex: 0, failedKeys: {} };
    }
}

function saveConfig(config) {
    configCache = config;
    configMtime = Date.now();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ============================================
// API KEY MANAGEMENT
// ============================================

function markKeyFailed(key) {
    const config = loadConfig();
    config.failedKeys = config.failedKeys || {};
    config.failedKeys[key] = Date.now();
    saveConfig(config);
}

function markKeyWorking(key) {
    const config = loadConfig();
    if (config.failedKeys && config.failedKeys[key]) {
        delete config.failedKeys[key];
        saveConfig(config);
    }
}

// ============================================
// FACTION DATA (using SQLite)
// ============================================

function loadFactionData(factionId) {
    const faction = db.getFaction(factionId);
    const snapshots = db.getSnapshotsNormalized(factionId, getThirtyDaysAgo());
    
    return {
        factionId,
        name: faction?.name || null,
        snapshots
    };
}

function addSnapshot(factionId, factionName, timestamp, activeMembers, totalMembers, allMemberIds) {
    db.addSnapshot(factionId, factionName, timestamp, activeMembers, totalMembers);
    
    // Prune old data periodically (1% chance per snapshot)
    if (Math.random() < 0.01) {
        const pruned = db.pruneOldData(30);
        if (pruned > 0) {
            console.log(`[DB] Pruned ${pruned} old snapshots`);
        }
    }
}

function getSnapshotsNormalized(factionData) {
    // If it's already normalized from DB, return as-is
    if (Array.isArray(factionData.snapshots)) {
        return factionData.snapshots;
    }
    return [];
}

function normalizeSnapshot(snapshot) {
    return {
        timestamp: snapshot.t || snapshot.timestamp,
        active: snapshot.a || snapshot.active || [],
        total: snapshot.n || snapshot.total || 0
    };
}

// ============================================
// MEMBER NAMES
// ============================================

function updateMemberNames(members) {
    db.upsertMembers(members);
}

function getMemberName(userId) {
    // Check cache first
    const cached = memberCache.get(`name:${userId}`);
    if (cached) return cached;
    
    const name = db.getMemberName(userId);
    if (name) {
        memberCache.set(`name:${userId}`, name);
    }
    return name;
}

// ============================================
// USER INDEX
// ============================================

function findUserInAllFactions(userId) {
    return db.getMemberFactions(userId);
}

function getUserFactions(userId) {
    return findUserInAllFactions(userId);
}

// ============================================
// FACTION MANAGEMENT
// ============================================

function addFactionsByRank(rankName, minMembers = null, maxMembers = null) {
    const hof = require('./hof');
    const factions = hof.getFactionsbyRank(rankName, minMembers, maxMembers);
    
    if (factions.length === 0) {
        return { added: 0, skipped: 0, factions: [] };
    }
    
    const config = loadConfig();
    let added = 0;
    let skipped = 0;
    const addedFactions = [];
    
    for (const faction of factions) {
        if (!config.factions.includes(faction.id)) {
            config.factions.push(faction.id);
            addedFactions.push(faction);
            added++;
        } else {
            skipped++;
        }
    }
    
    if (added > 0) {
        saveConfig(config);
    }
    
    return { added, skipped, factions: addedFactions };
}

function removeFactionsByRank(rankName, minMembers = null, maxMembers = null) {
    const hof = require('./hof');
    const factions = hof.getFactionsbyRank(rankName, minMembers, maxMembers);
    
    if (factions.length === 0) {
        return { removed: 0, factions: [] };
    }
    
    const config = loadConfig();
    const factionIds = factions.map(f => f.id);
    const initialLength = config.factions.length;
    const removedFactions = [];
    
    config.factions = config.factions.filter(id => {
        if (factionIds.includes(id)) {
            const faction = factions.find(f => f.id === id);
            if (faction) removedFactions.push(faction);
            return false;
        }
        return true;
    });
    
    const removed = initialLength - config.factions.length;
    
    if (removed > 0) {
        saveConfig(config);
    }
    
    return { removed, factions: removedFactions };
}

function addFactionsByIds(ids) {
    const config = loadConfig();
    let added = 0;
    let skipped = 0;
    
    for (const id of ids) {
        if (!config.factions.includes(id)) {
            config.factions.push(id);
            added++;
        } else {
            skipped++;
        }
    }
    
    if (added > 0) {
        saveConfig(config);
    }
    
    return { added, skipped };
}

function removeFactionsByIds(ids) {
    const config = loadConfig();
    const initialLength = config.factions.length;
    
    config.factions = config.factions.filter(id => !ids.includes(id));
    
    const removed = initialLength - config.factions.length;
    
    if (removed > 0) {
        saveConfig(config);
    }
    
    return { removed };
}

function addApiKeys(keys) {
    const config = loadConfig();
    let added = 0;
    let skipped = 0;
    
    for (const key of keys) {
        if (!config.apikeys.includes(key)) {
            config.apikeys.push(key);
            added++;
        } else {
            skipped++;
        }
    }
    
    if (added > 0) {
        saveConfig(config);
    }
    
    return { added, skipped };
}

function removeApiKey(key) {
    const config = loadConfig();
    const index = config.apikeys.indexOf(key);
    
    if (index === -1) {
        return { removed: false };
    }
    
    config.apikeys.splice(index, 1);
    
    if (config.currentKeyIndex >= config.apikeys.length) {
        config.currentKeyIndex = 0;
    }
    
    saveConfig(config);
    
    return { removed: true };
}

// ============================================
// SEARCH
// ============================================

function searchFactionByName(query) {
    const config = loadConfig();
    const results = [];
    const q = query.toLowerCase().trim();
    
    for (const factionId of config.factions) {
        const faction = db.getFaction(factionId);
        const name = faction?.name || `Faction ${factionId}`;
        
        if (name.toLowerCase().includes(q) || factionId.toString().includes(q)) {
            results.push({ id: factionId, name });
        }
    }
    
    results.sort((a, b) => {
        const aLower = a.name.toLowerCase();
        const bLower = b.name.toLowerCase();
        
        if (aLower === q) return -1;
        if (bLower === q) return 1;
        if (aLower.startsWith(q) && !bLower.startsWith(q)) return -1;
        if (bLower.startsWith(q) && !aLower.startsWith(q)) return 1;
        return a.name.localeCompare(b.name);
    });
    
    return results.slice(0, 25);
}

function searchMemberByName(query) {
    return db.searchMembers(query, 25).map(m => ({
        id: m.id,
        name: m.name
    }));
}

function resolveFaction(input) {
    const asNumber = parseInt(input);
    if (!isNaN(asNumber) && asNumber.toString() === input.trim()) {
        const faction = db.getFaction(asNumber);
        return {
            id: asNumber,
            name: faction?.name || `Faction ${asNumber}`
        };
    }
    
    const results = searchFactionByName(input);
    if (results.length === 0) return null;
    
    const exact = results.find(r => r.name.toLowerCase() === input.toLowerCase());
    return exact || results[0];
}

function resolveMember(input) {
    const asNumber = parseInt(input);
    if (!isNaN(asNumber) && asNumber.toString() === input.trim()) {
        const name = getMemberName(asNumber);
        return {
            id: asNumber,
            name: name || `User ${asNumber}`
        };
    }
    
    const results = searchMemberByName(input);
    if (results.length === 0) return null;
    
    const exact = results.find(r => r.name.toLowerCase() === input.toLowerCase());
    return exact || results[0];
}

function getAllFactionChoices() {
    const config = loadConfig();
    const choices = [];
    
    for (const factionId of config.factions.slice(0, 25)) {
        const faction = db.getFaction(factionId);
        const name = faction?.name || `Faction ${factionId}`;
        choices.push({
            name: `${name} [${factionId}]`,
            value: factionId.toString()
        });
    }
    
    return choices;
}

function getAllMemberChoices() {
    const members = db.getDb().prepare(`
        SELECT id, name FROM members 
        ORDER BY last_seen DESC 
        LIMIT 25
    `).all();
    
    return members.map(m => ({
        name: `${m.name} [${m.id}]`,
        value: m.id.toString()
    }));
}

// ============================================
// STATS
// ============================================

function getFactionStats() {
    const config = loadConfig();
    const dbStats = db.getDbStats();
    
    return {
        configured: config.factions.length,
        withData: dbStats.factions,
        totalSnapshots: dbStats.snapshots,
        dbSize: dbStats.dbSize
    };
}

function getAllTrackedFactionIds() {
    return loadConfig().factions;
}

// ============================================
// HELPERS
// ============================================

function getThirtyDaysAgo() {
    return Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
}

module.exports = {
    loadConfig,
    saveConfig,
    markKeyFailed,
    markKeyWorking,
    loadFactionData,
    addSnapshot,
    getSnapshotsNormalized,
    normalizeSnapshot,
    updateMemberNames,
    getMemberName,
    findUserInAllFactions,
    getUserFactions,
    addFactionsByRank,
    removeFactionsByRank,
    addFactionsByIds,
    removeFactionsByIds,
    addApiKeys,
    removeApiKey,
    searchFactionByName,
    searchMemberByName,
    resolveFaction,
    resolveMember,
    getAllFactionChoices,
    getAllMemberChoices,
    getFactionStats,
    getAllTrackedFactionIds,
    getThirtyDaysAgo
};