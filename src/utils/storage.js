const fs = require('fs');
const path = require('path');
const db = require('../database');
const { memberCache } = require('./cache');
const { encrypt, decrypt } = require('./crypto');
const { getThirtyDaysAgo } = require('./helpers');
const { dbLog } = require('./logger');

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
        const config = JSON.parse(data);
        
        // Migrate old format to new format
        if (config.apikeys && config.apikeys.length > 0 && typeof config.apikeys[0] === 'string') {
            config.apikeys = config.apikeys.map(key => ({
                key: decrypt(key),
                rateLimit: require('../config').api.defaultCallsPerKeyPerMinute
            }));
        } else if (config.apikeys) {
            // Decrypt keys in new format
            config.apikeys = config.apikeys.map(entry => ({
                ...entry,
                key: decrypt(entry.key)
            }));
        }
        
        configCache = config;
        configMtime = stats.mtimeMs;
        return configCache;
    } catch (error) {
        return { factions: [], apikeys: [], currentKeyIndex: 0, failedKeys: {} };
    }
}

function saveConfig(config) {
    // Encrypt keys when saving
    const configToSave = {
        ...config,
        apikeys: config.apikeys.map(entry => ({
            ...entry,
            key: encrypt(entry.key)
        }))
    };
    
    configCache = config;
    configMtime = Date.now();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(configToSave, null, 2));
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
        const pruned = db.pruneOldData();
        if (pruned > 0) {
            dbLog.info({ pruned }, 'Pruned old snapshots');
        }
    }
}

function getSnapshotsNormalized(factionData) {
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

function addApiKey(key, rateLimit = null) {
    const appConfig = require('../config');
    const config = loadConfig();
    
    // Use provided rate limit or default
    const effectiveRateLimit = Math.min(
        rateLimit || appConfig.api.defaultCallsPerKeyPerMinute,
        appConfig.api.maxCallsPerKeyPerMinute
    );
    
    // Check if key already exists
    const exists = config.apikeys.some(entry => entry.key === key);
    
    if (exists) {
        return { added: false, reason: 'Key already exists' };
    }
    
    config.apikeys.push({
        key,
        rateLimit: effectiveRateLimit
    });
    
    saveConfig(config);
    
    return { added: true, rateLimit: effectiveRateLimit };
}

function addApiKeys(keys) {
    let added = 0;
    let skipped = 0;
    
    for (const key of keys) {
        const result = addApiKey(key);
        if (result.added) {
            added++;
        } else {
            skipped++;
        }
    }
    
    return { added, skipped };
}

function getKeyRateLimit(key) {
    const appConfig = require('../config');
    const config = loadConfig();
    const entry = config.apikeys.find(e => e.key === key);
    return entry?.rateLimit || appConfig.api.defaultCallsPerKeyPerMinute;
}

function removeApiKey(key) {
    const config = loadConfig();
    const initialLength = config.apikeys.length;
    
    config.apikeys = config.apikeys.filter(entry => entry.key !== key);
    
    const removed = initialLength > config.apikeys.length;
    
    if (removed) {
        saveConfig(config);
    }
    
    return { removed };
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

function getApiKeys() {
    const config = loadConfig();
    return config.apikeys.map(entry => entry.key);
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
    addApiKey,
    addApiKeys,
    removeApiKey,
    getApiKeys,
    getKeyRateLimit,
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