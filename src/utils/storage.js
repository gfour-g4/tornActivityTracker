const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../../config.json');
const DATA_DIR = path.join(__dirname, '../../data');
const USER_INDEX_PATH = path.join(DATA_DIR, 'user_index.json');
const MEMBER_NAMES_PATH = path.join(DATA_DIR, 'member_names.json');

// Cache for frequently accessed data
// NOTE: This is RAM cache only - disk storage is unlimited
const cache = {
    config: null,
    configMtime: 0,
    userIndex: null,
    userIndexMtime: 0,
    memberNames: null,
    memberNamesMtime: 0,
    factionData: new Map(), // factionId -> { data, mtime, lastAccess }
    maxCacheSize: 100 // Max factions to keep in RAM (not disk limit!)
};

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
        if (cache.config && cache.configMtime === stats.mtimeMs) {
            return cache.config;
        }
        
        const data = fs.readFileSync(CONFIG_PATH, 'utf8');
        cache.config = JSON.parse(data);
        cache.configMtime = stats.mtimeMs;
        return cache.config;
    } catch (error) {
        return { factions: [], apikeys: [], currentKeyIndex: 0, failedKeys: {} };
    }
}

function saveConfig(config) {
    cache.config = config;
    cache.configMtime = Date.now();
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
// MEMBER NAMES
// ============================================

function loadMemberNames() {
    ensureDataDir();
    
    try {
        const stats = fs.statSync(MEMBER_NAMES_PATH);
        if (cache.memberNames && cache.memberNamesMtime === stats.mtimeMs) {
            return cache.memberNames;
        }
        
        const data = fs.readFileSync(MEMBER_NAMES_PATH, 'utf8');
        cache.memberNames = JSON.parse(data);
        cache.memberNamesMtime = stats.mtimeMs;
        return cache.memberNames;
    } catch (error) {
        return {};
    }
}

function saveMemberNames(names) {
    ensureDataDir();
    cache.memberNames = names;
    cache.memberNamesMtime = Date.now();
    fs.writeFileSync(MEMBER_NAMES_PATH, JSON.stringify(names));
}

function updateMemberNames(members) {
    const names = loadMemberNames();
    let changed = false;
    
    for (const [id, data] of Object.entries(members)) {
        if (data.name && names[id] !== data.name) {
            names[id] = data.name;
            changed = true;
        }
    }
    
    if (changed) {
        saveMemberNames(names);
    }
}

function getMemberName(userId) {
    const names = loadMemberNames();
    return names[userId] || null;
}

// ============================================
// USER INDEX
// ============================================

function loadUserIndex() {
    ensureDataDir();
    
    try {
        const stats = fs.statSync(USER_INDEX_PATH);
        if (cache.userIndex && cache.userIndexMtime === stats.mtimeMs) {
            return cache.userIndex;
        }
        
        const data = fs.readFileSync(USER_INDEX_PATH, 'utf8');
        cache.userIndex = JSON.parse(data);
        cache.userIndexMtime = stats.mtimeMs;
        return cache.userIndex;
    } catch (error) {
        return {};
    }
}

function saveUserIndex(index) {
    ensureDataDir();
    cache.userIndex = index;
    cache.userIndexMtime = Date.now();
    fs.writeFileSync(USER_INDEX_PATH, JSON.stringify(index));
}

function updateUserIndex(factionId, memberIds) {
    const index = loadUserIndex();
    let changed = false;
    
    for (const memberId of memberIds) {
        const id = memberId.toString();
        if (!index[id]) {
            index[id] = [];
        }
        if (!index[id].includes(factionId)) {
            index[id].push(factionId);
            changed = true;
        }
    }
    
    if (changed) {
        saveUserIndex(index);
    }
}

function getUserFactions(userId) {
    const index = loadUserIndex();
    return index[userId.toString()] || [];
}

// ============================================
// FACTION DATA
// ============================================

function getFactionDataPath(factionId) {
    return path.join(DATA_DIR, `faction_${factionId}.json`);
}

function evictOldestFromCache() {
    if (cache.factionData.size < cache.maxCacheSize) return;
    
    // Find least recently accessed
    let oldestKey = null;
    let oldestTime = Infinity;
    
    for (const [key, value] of cache.factionData) {
        if (value.lastAccess < oldestTime) {
            oldestTime = value.lastAccess;
            oldestKey = key;
        }
    }
    
    if (oldestKey !== null) {
        cache.factionData.delete(oldestKey);
    }
}

function loadFactionData(factionId, useCache = true) {
    ensureDataDir();
    const filePath = getFactionDataPath(factionId);
    
    try {
        const stats = fs.statSync(filePath);
        
        if (useCache) {
            const cached = cache.factionData.get(factionId);
            if (cached && cached.mtime === stats.mtimeMs) {
                cached.lastAccess = Date.now();
                return cached.data;
            }
        }
        
        const data = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(data);
        
        // Manage cache size (LRU eviction)
        evictOldestFromCache();
        
        cache.factionData.set(factionId, { 
            data: parsed, 
            mtime: stats.mtimeMs,
            lastAccess: Date.now()
        });
        
        return parsed;
    } catch (error) {
        return {
            factionId: factionId,
            name: null,
            snapshots: []
        };
    }
}

function saveFactionData(factionId, data) {
    ensureDataDir();
    const filePath = getFactionDataPath(factionId);
    
    // Update cache
    cache.factionData.set(factionId, { 
        data, 
        mtime: Date.now(),
        lastAccess: Date.now()
    });
    
    // Write to file (compact JSON, no formatting)
    fs.writeFileSync(filePath, JSON.stringify(data));
}

function addSnapshot(factionId, factionName, timestamp, activeMembers, totalMembers, allMemberIds) {
    const data = loadFactionData(factionId, false);
    data.name = factionName;
    
    // Use compact format
    data.snapshots.push({
        t: timestamp,
        a: activeMembers,
        n: totalMembers
    });
    
    // Prune old data (older than 30 days)
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
    data.snapshots = data.snapshots.filter(s => (s.t || s.timestamp) >= thirtyDaysAgo);
    
    saveFactionData(factionId, data);
    
    // Update user index with all members
    if (allMemberIds && allMemberIds.length > 0) {
        updateUserIndex(factionId, allMemberIds);
    }
}

// Normalize snapshot format (handle both old and new formats)
function normalizeSnapshot(snapshot) {
    return {
        timestamp: snapshot.t || snapshot.timestamp,
        active: snapshot.a || snapshot.active || [],
        total: snapshot.n || snapshot.total || 0
    };
}

function getSnapshotsNormalized(factionData) {
    return (factionData.snapshots || []).map(normalizeSnapshot);
}

// ============================================
// MULTI-FACTION SEARCH
// ============================================

function findUserInAllFactions(userId) {
    const factionIds = getUserFactions(userId);
    
    if (factionIds.length === 0) {
        // Fallback: scan all faction files (slower, but needed for initial index building)
        return scanAllFactionsForUser(userId);
    }
    
    return factionIds;
}

function scanAllFactionsForUser(userId) {
    ensureDataDir();
    const files = fs.readdirSync(DATA_DIR).filter(f => 
        f.startsWith('faction_') && f.endsWith('.json')
    );
    
    const foundFactions = [];
    
    for (const file of files) {
        const match = file.match(/faction_(\d+)\.json/);
        if (!match) continue;
        
        const factionId = parseInt(match[1]);
        const data = loadFactionData(factionId);
        const snapshots = getSnapshotsNormalized(data);
        
        for (const snapshot of snapshots) {
            if (snapshot.active.includes(userId)) {
                foundFactions.push(factionId);
                break;
            }
        }
    }
    
    // Update index for future lookups
    if (foundFactions.length > 0) {
        const index = loadUserIndex();
        index[userId.toString()] = foundFactions;
        saveUserIndex(index);
    }
    
    return foundFactions;
}

function getAllTrackedFactionIds() {
    ensureDataDir();
    const files = fs.readdirSync(DATA_DIR).filter(f => 
        f.startsWith('faction_') && f.endsWith('.json')
    );
    
    return files.map(f => {
        const match = f.match(/faction_(\d+)\.json/);
        return match ? parseInt(match[1]) : null;
    }).filter(id => id !== null);
}

function getAllFactionData() {
    const factionIds = getAllTrackedFactionIds();
    const factions = {};
    
    for (const factionId of factionIds) {
        factions[factionId] = loadFactionData(factionId);
    }
    
    return factions;
}

// Get basic stats without loading all data
function getFactionStats() {
    ensureDataDir();
    const config = loadConfig();
    const stats = {
        configured: config.factions.length,
        withData: 0,
        totalSnapshots: 0
    };
    
    const files = fs.readdirSync(DATA_DIR).filter(f => 
        f.startsWith('faction_') && f.endsWith('.json')
    );
    
    stats.withData = files.length;
    
    return stats;
}

// ============================================
// CLEANUP
// ============================================

function clearCache() {
    cache.config = null;
    cache.userIndex = null;
    cache.memberNames = null;
    cache.factionData.clear();
}

// ============================================
// NAME SEARCH
// ============================================

function searchFactionByName(query) {
    const config = loadConfig();
    const results = [];
    const q = query.toLowerCase().trim();
    
    for (const factionId of config.factions) {
        const data = loadFactionData(factionId);
        const name = data.name || `Faction ${factionId}`;
        
        if (name.toLowerCase().includes(q) || factionId.toString().includes(q)) {
            results.push({
                id: factionId,
                name: name
            });
        }
    }
    
    // Sort by relevance (exact match first, then starts with, then contains)
    results.sort((a, b) => {
        const aLower = a.name.toLowerCase();
        const bLower = b.name.toLowerCase();
        
        const aExact = aLower === q;
        const bExact = bLower === q;
        if (aExact && !bExact) return -1;
        if (bExact && !aExact) return 1;
        
        const aStarts = aLower.startsWith(q);
        const bStarts = bLower.startsWith(q);
        if (aStarts && !bStarts) return -1;
        if (bStarts && !aStarts) return 1;
        
        return a.name.localeCompare(b.name);
    });
    
    return results.slice(0, 25); // Discord limit
}

function searchMemberByName(query) {
    const names = loadMemberNames();
    const results = [];
    const q = query.toLowerCase().trim();
    
    for (const [id, name] of Object.entries(names)) {
        if (name.toLowerCase().includes(q) || id.includes(q)) {
            results.push({
                id: parseInt(id),
                name: name
            });
        }
    }
    
    // Sort by relevance
    results.sort((a, b) => {
        const aLower = a.name.toLowerCase();
        const bLower = b.name.toLowerCase();
        
        const aExact = aLower === q;
        const bExact = bLower === q;
        if (aExact && !bExact) return -1;
        if (bExact && !aExact) return 1;
        
        const aStarts = aLower.startsWith(q);
        const bStarts = bLower.startsWith(q);
        if (aStarts && !bStarts) return -1;
        if (bStarts && !aStarts) return 1;
        
        return a.name.localeCompare(b.name);
    });
    
    return results.slice(0, 25);
}

function resolveFaction(input) {
    // If it's a number, use as ID
    const asNumber = parseInt(input);
    if (!isNaN(asNumber) && asNumber.toString() === input.trim()) {
        const data = loadFactionData(asNumber);
        return {
            id: asNumber,
            name: data.name || `Faction ${asNumber}`
        };
    }
    
    // Search by name
    const results = searchFactionByName(input);
    if (results.length === 0) {
        return null;
    }
    
    // Return exact match if exists, otherwise first result
    const exact = results.find(r => r.name.toLowerCase() === input.toLowerCase());
    return exact || results[0];
}

function resolveMember(input) {
    // If it's a number, use as ID
    const asNumber = parseInt(input);
    if (!isNaN(asNumber) && asNumber.toString() === input.trim()) {
        const name = getMemberName(asNumber);
        return {
            id: asNumber,
            name: name || `User ${asNumber}`
        };
    }
    
    // Search by name
    const results = searchMemberByName(input);
    if (results.length === 0) {
        return null;
    }
    
    const exact = results.find(r => r.name.toLowerCase() === input.toLowerCase());
    return exact || results[0];
}

function getAllFactionChoices() {
    const config = loadConfig();
    const choices = [];
    
    for (const factionId of config.factions) {
        const data = loadFactionData(factionId);
        const name = data.name || `Faction ${factionId}`;
        choices.push({
            name: `${name} [${factionId}]`,
            value: factionId.toString()
        });
    }
    
    return choices.slice(0, 25);
}

function getAllMemberChoices() {
    const names = loadMemberNames();
    const choices = [];
    
    for (const [id, name] of Object.entries(names)) {
        choices.push({
            name: `${name} [${id}]`,
            value: id
        });
    }
    
    return choices.slice(0, 25);
}

// ============================================
// RANK-BASED FACTION MANAGEMENT
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

module.exports = {
    loadConfig,
    saveConfig,
    markKeyFailed,
    markKeyWorking,
    loadFactionData,
    saveFactionData,
    addSnapshot,
    getSnapshotsNormalized,
    normalizeSnapshot,
    loadMemberNames,
    updateMemberNames,
    getMemberName,
    loadUserIndex,
    getUserFactions,
    updateUserIndex,
    findUserInAllFactions,
    getAllFactionData,
    getAllTrackedFactionIds,
    getFactionStats,
    clearCache,
    searchFactionByName,
    searchMemberByName,
    resolveFaction,
    resolveMember,
    getAllFactionChoices,
    getAllMemberChoices,
    // New exports
    addFactionsByRank,
    removeFactionsByRank,
    addFactionsByIds,
    removeFactionsByIds,
    addApiKeys,
    removeApiKey
};