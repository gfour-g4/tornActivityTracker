const fs = require('fs');
const path = require('path');
const api = require('./api');

const DATA_DIR = path.join(__dirname, '../../data');
const HOF_CACHE_PATH = path.join(DATA_DIR, 'hof_cache.json');

// Update HOF cache every 7 days
const HOF_UPDATE_INTERVAL = 7 * 24 * 60 * 60 * 1000;

// Only track these ranks
const TRACKED_RANKS = ['diamond', 'platinum'];

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
    return (now - cache.lastUpdated) > HOF_UPDATE_INTERVAL;
}

function isTrackedRank(rank) {
    if (!rank) return false;
    const rankLower = rank.toLowerCase();
    return TRACKED_RANKS.some(r => rankLower.includes(r));
}

function isBelowTrackedRanks(rank) {
    if (!rank) return false;
    const rankLower = rank.toLowerCase();
    // If it's Gold or below, we've passed the ranks we care about
    const belowRanks = ['gold', 'silver', 'bronze', 'unranked'];
    return belowRanks.some(r => rankLower.includes(r));
}

async function updateHOFCache(progressCallback = null) {
    console.log('[HOF] Updating faction Hall of Fame cache (Diamond & Platinum only)...');
    
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
        
        // Stop if we've seen 50+ non-tracked factions in a row (we've passed Diamond/Platinum)
        if (consecutiveNonTracked >= 50) {
            console.log(`[HOF] Reached Gold rank, stopping (found ${allFactions.length} Diamond/Platinum factions)`);
            hasMore = false;
            break;
        }
        
        // Stop if no next page
        if (!data._metadata?.links?.next) {
            hasMore = false;
            break;
        }
        
        offset += limit;
        
        // Safety limit
        if (offset >= 2000) {
            hasMore = false;
            break;
        }
        
        // Small delay between pages
        await new Promise(r => setTimeout(r, 500));
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
    
    console.log(`[HOF] Cached ${allFactions.length} factions (Diamond & Platinum)`);
    
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
        console.warn(`[HOF] Rank "${rankName}" is not tracked. Only ${TRACKED_RANKS.join(', ')} are available.`);
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