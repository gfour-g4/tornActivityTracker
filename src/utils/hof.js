
const fs = require('fs');
const path = require('path');
const api = require('./api');
const config = require('../config');
const { hofLog } = require('./logger');

const DATA_DIR = path.join(__dirname, '../../data');
const HOF_CACHE_PATH = path.join(DATA_DIR, 'hof_cache.json');

const TRACKED_RANKS = config.hof.trackedRanks;

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function loadHOFCache() {
    ensureDataDir();
    
    try {
        const data = fs.readFileSync(HOF_CACHE_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return {
            lastUpdated: 0,
            factions: []
        };
    }
}

function saveHOFCache(cache) {
    ensureDataDir();
    fs.writeFileSync(HOF_CACHE_PATH, JSON.stringify(cache));
}

function isHOFCacheStale() {
    const cache = loadHOFCache();
    const now = Date.now();
    return (now - cache.lastUpdated) > config.hof.updateIntervalMs;
}

function isTrackedRank(rank) {
    if (!rank) return false;
    const rankLower = rank.toLowerCase();
    return TRACKED_RANKS.some(r => rankLower.includes(r));
}

function isBelowTrackedRanks(rank) {
    if (!rank) return false;
    const rankLower = rank.toLowerCase();
    const belowRanks = ['gold', 'silver', 'bronze', 'unranked'];
    return belowRanks.some(r => rankLower.includes(r));
}

async function updateHOFCache(progressCallback = null) {
    hofLog.info({ trackedRanks: TRACKED_RANKS }, 'Updating faction Hall of Fame cache');
    
    const allFactions = [];
    let offset = 0;
    const limit = 100;
    let hasMore = true;
    let page = 0;
    let consecutiveNonTracked = 0;
    
    while (hasMore) {
        page++;
        if (progressCallback) {
            progressCallback(page, allFactions.length);
        }
        
        const data = await api.fetchHOFPage(offset, limit);
        
        if (!data.factionhof || data.factionhof.length === 0) {
            hasMore = false;
            break;
        }
        
        let foundTrackedThisPage = false;
        
        for (const faction of data.factionhof) {
            if (isTrackedRank(faction.rank)) {
                allFactions.push(faction);
                foundTrackedThisPage = true;
                consecutiveNonTracked = 0;
            } else if (isBelowTrackedRanks(faction.rank)) {
                consecutiveNonTracked++;
            }
        }
        
        if (consecutiveNonTracked >= 50) {
            hofLog.info({ count: allFactions.length }, 'Reached Gold rank, stopping');
            hasMore = false;
            break;
        }
        
        if (!data._metadata?.links?.next) {
            hasMore = false;
            break;
        }
        
        offset += limit;
        
        if (offset >= 2000) {
            hasMore = false;
            break;
        }
        
        await new Promise(r => setTimeout(r, config.hof.pageFetchDelayMs));
    }
    
    const cache = {
        lastUpdated: Date.now(),
        factions: allFactions.map(f => ({
            id: f.id,
            name: f.name,
            members: f.members,
            position: f.position,
            rank: f.rank
        }))
    };
    
    saveHOFCache(cache);
    
    hofLog.info({ count: allFactions.length }, 'HOF cache updated');
    
    return cache;
}

async function ensureHOFCache() {
    if (isHOFCacheStale()) {
        return await updateHOFCache();
    }
    return loadHOFCache();
}

function getFactionsbyRank(rankName, minMembers = null, maxMembers = null) {
    const cache = loadHOFCache();
    const rankLower = rankName.toLowerCase();
    
    if (!TRACKED_RANKS.includes(rankLower)) {
        hofLog.warn({ rank: rankName, available: TRACKED_RANKS }, 'Rank not tracked');
        return [];
    }
    
    let filtered = cache.factions.filter(f => {
        const factionRank = (f.rank || '').toLowerCase();
        return factionRank.includes(rankLower);
    });
    
    if (minMembers !== null && minMembers > 0) {
        filtered = filtered.filter(f => f.members >= minMembers);
    }
    
    if (maxMembers !== null && maxMembers > 0) {
        filtered = filtered.filter(f => f.members <= maxMembers);
    }
    
    return filtered;
}

function getFactionFromHOF(factionId) {
    const cache = loadHOFCache();
    return cache.factions.find(f => f.id === factionId) || null;
}

function searchHOFByName(query) {
    const cache = loadHOFCache();
    const q = query.toLowerCase().trim();
    
    const results = cache.factions.filter(f => 
        f.name.toLowerCase().includes(q) || 
        f.id.toString().includes(q)
    );
    
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
        
        return a.position - b.position;
    });
    
    return results.slice(0, 25);
}

function getHOFStats() {
    const cache = loadHOFCache();
    
    const rankCounts = {};
    for (const faction of cache.factions) {
        const baseRank = (faction.rank || 'Unknown').split(' ')[0];
        rankCounts[baseRank] = (rankCounts[baseRank] || 0) + 1;
    }
    
    return {
        total: cache.factions.length,
        lastUpdated: cache.lastUpdated,
        byRank: rankCounts
    };
}

function getTrackedRanks() {
    return TRACKED_RANKS;
}

module.exports = {
    loadHOFCache,
    saveHOFCache,
    isHOFCacheStale,
    updateHOFCache,
    ensureHOFCache,
    getFactionsbyRank,
    getFactionFromHOF,
    searchHOFByName,
    getHOFStats,
    getTrackedRanks,
    TRACKED_RANKS
};