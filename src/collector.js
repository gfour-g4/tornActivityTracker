const api = require('./utils/api');
const storage = require('./utils/storage');

let collectorInterval = null;
let isCollecting = false;
let lastCollectionStats = null;

// Collection interval: 15 minutes
const COLLECTION_INTERVAL = 15 * 60 * 1000;

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function collectFactionData(factionId) {
    try {
        const pollTimestamp = Math.floor(Date.now() / 1000);
        const factionData = await api.fetchFaction(factionId);
        const { active, total, allMemberIds, members } = api.processActivitySnapshot(factionData, pollTimestamp);
        
        // Update member names
        storage.updateMemberNames(members);
        
        // Add snapshot
        storage.addSnapshot(
            factionId, 
            factionData.name, 
            pollTimestamp, 
            active, 
            total,
            allMemberIds
        );
        
        return { success: true, factionId, name: factionData.name, active: active.length, total };
    } catch (error) {
        return { success: false, factionId, error: error.message };
    }
}

async function collectAllFactions() {
    if (isCollecting) {
        console.log('[Collector] Collection already in progress, skipping...');
        return null;
    }
    
    isCollecting = true;
    
    const config = storage.loadConfig();
    
    if (config.factions.length === 0) {
        console.log('[Collector] No factions configured to track.');
        isCollecting = false;
        return null;
    }
    
    if (config.apikeys.length === 0) {
        console.log('[Collector] No API keys configured.');
        isCollecting = false;
        return null;
    }
    
    const startTime = Date.now();
    const estimatedTime = api.estimateCollectionTime(config.factions.length);
    
    console.log(`[${new Date().toISOString()}] Starting collection...`);
    console.log(`  Factions: ${config.factions.length}`);
    console.log(`  API Keys: ${config.apikeys.length}`);
    console.log(`  Rate Limit: ${api.RATE_LIMIT_PER_KEY} calls/min/key`);
    console.log(`  Estimated time: ${Math.ceil(estimatedTime / 60)} minutes`);
    
    if (estimatedTime > 14 * 60) {
        console.warn(`  ⚠️ Warning: Collection may not finish before next interval!`);
        console.warn(`     Consider adding more API keys.`);
    }
    
    const results = {
        success: 0,
        failed: 0,
        errors: [],
        startTime,
        endTime: null
    };
    
    // Process factions one by one - rate limiting is handled by API module
    let processedCount = 0;
    
    for (const factionId of config.factions) {
        const result = await collectFactionData(factionId);
        processedCount++;
        
        if (result.success) {
            results.success++;
            // Log progress every 50 factions or for small collections
            if (config.factions.length <= 20 || processedCount % 50 === 0) {
                console.log(`  [${processedCount}/${config.factions.length}] ✓ ${result.name}: ${result.active}/${result.total} active`);
            }
        } else {
            results.failed++;
            results.errors.push({ factionId, error: result.error });
            console.log(`  [${processedCount}/${config.factions.length}] ✗ Faction ${factionId}: ${result.error}`);
        }
        
        // Small delay between requests to be nice
        await sleep(100);
    }
    
    results.endTime = Date.now();
    const duration = (results.endTime - results.startTime) / 1000;
    
    console.log(`[${new Date().toISOString()}] Collection complete!`);
    console.log(`  Success: ${results.success}/${config.factions.length}`);
    console.log(`  Failed: ${results.failed}`);
    console.log(`  Duration: ${Math.floor(duration / 60)}m ${Math.floor(duration % 60)}s`);
    
    lastCollectionStats = results;
    isCollecting = false;
    
    return results;
}

function startCollector() {
    if (collectorInterval) {
        console.log('[Collector] Already running.');
        return;
    }
    
    const config = storage.loadConfig();
    console.log(`[Collector] Starting...`);
    console.log(`  Tracking ${config.factions.length} factions`);
    console.log(`  Using ${config.apikeys.length} API keys`);
    console.log(`  Collection interval: 15 minutes`);
    
    // Collect immediately on start
    collectAllFactions();
    
    // Then every 15 minutes
    collectorInterval = setInterval(collectAllFactions, COLLECTION_INTERVAL);
}

function stopCollector() {
    if (collectorInterval) {
        clearInterval(collectorInterval);
        collectorInterval = null;
        console.log('[Collector] Stopped.');
    }
}

function getCollectorStatus() {
    const config = storage.loadConfig();
    
    return {
        running: collectorInterval !== null,
        collecting: isCollecting,
        factionCount: config.factions.length,
        keyCount: config.apikeys.length,
        rateLimit: api.RATE_LIMIT_PER_KEY,
        estimatedCollectionTime: api.estimateCollectionTime(config.factions.length),
        lastCollection: lastCollectionStats,
        rateLimitStatus: api.getRateLimitStatus()
    };
}

module.exports = {
    startCollector,
    stopCollector,
    collectAllFactions,
    collectFactionData,
    getCollectorStatus
};