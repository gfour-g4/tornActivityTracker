const api = require('./utils/api');
const storage = require('./utils/storage');
const hof = require('./utils/hof');
const db = require('./database');

let collectorInterval = null;
let hofInterval = null;
let isCollecting = false;
let lastCollectionStats = null;

const COLLECTION_INTERVAL = 15 * 60 * 1000; // 15 minutes
const HOF_UPDATE_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 7 days

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function collectFactionData(factionId) {
    try {
        const pollTimestamp = Math.floor(Date.now() / 1000);
        const factionData = await api.fetchFaction(factionId);
        const { active, total, allMemberIds, members } = api.processActivitySnapshot(factionData, pollTimestamp);
        
        storage.updateMemberNames(members);
        
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
    const keyCount = config.apikeys.length;
    const concurrency = Math.min(keyCount * 2, 10); // 2 concurrent per key, max 10
    
    console.log(`[${new Date().toISOString()}] Starting parallel collection...`);
    console.log(`  Factions: ${config.factions.length}`);
    console.log(`  API Keys: ${keyCount}`);
    console.log(`  Concurrency: ${concurrency}`);
    
    const results = {
        success: 0,
        failed: 0,
        skipped: 0,
        errors: [],
        startTime,
        endTime: null
    };
    
    // Filter out inactive factions (collect them less frequently)
    const factionQueue = [];
    const skippedInactive = [];
    
    for (const factionId of config.factions) {
        if (db.isInactiveFaction(factionId)) {
            // Skip 75% of the time for inactive factions
            if (Math.random() < 0.75) {
                skippedInactive.push(factionId);
                results.skipped++;
                continue;
            }
        }
        factionQueue.push(factionId);
    }
    
    if (skippedInactive.length > 0) {
        console.log(`  Skipping ${skippedInactive.length} inactive factions`);
    }
    
    let processedCount = 0;
    const totalToProcess = factionQueue.length;
    
    // Parallel processing
    async function processNext() {
        while (factionQueue.length > 0) {
            const factionId = factionQueue.shift();
            const result = await collectFactionData(factionId);
            processedCount++;
            
            if (result.success) {
                results.success++;
                if (totalToProcess <= 20 || processedCount % 50 === 0) {
                    console.log(`  [${processedCount}/${totalToProcess}] ✓ ${result.name}: ${result.active}/${result.total}`);
                }
            } else {
                results.failed++;
                results.errors.push({ factionId, error: result.error });
                console.log(`  [${processedCount}/${totalToProcess}] ✗ ${factionId}: ${result.error}`);
            }
        }
    }
    
    // Start concurrent workers
    const workers = [];
    for (let i = 0; i < concurrency; i++) {
        workers.push(processNext());
    }
    
    await Promise.all(workers);
    
    results.endTime = Date.now();
    const duration = (results.endTime - results.startTime) / 1000;
    
    console.log(`[${new Date().toISOString()}] Collection complete!`);
    console.log(`  Success: ${results.success}`);
    console.log(`  Failed: ${results.failed}`);
    console.log(`  Skipped (inactive): ${results.skipped}`);
    console.log(`  Duration: ${Math.floor(duration / 60)}m ${Math.floor(duration % 60)}s`);
    
    lastCollectionStats = results;
    isCollecting = false;
    
    return results;
}

async function updateHOFIfNeeded() {
    if (hof.isHOFCacheStale()) {
        console.log('[Collector] HOF cache is stale, updating...');
        try {
            await hof.updateHOFCache();
        } catch (error) {
            console.error('[Collector] Failed to update HOF cache:', error.message);
        }
    }
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
    
    // Initialize database
    db.getDb();
    console.log('[DB] Database initialized');
    
    // Update HOF on startup if needed
    updateHOFIfNeeded();
    
    // Collect immediately on start
    collectAllFactions();
    
    // Then every 15 minutes
    collectorInterval = setInterval(collectAllFactions, COLLECTION_INTERVAL);
    
    // Check HOF daily
    hofInterval = setInterval(updateHOFIfNeeded, 24 * 60 * 60 * 1000);
}

function stopCollector() {
    if (collectorInterval) {
        clearInterval(collectorInterval);
        collectorInterval = null;
    }
    
    if (hofInterval) {
        clearInterval(hofInterval);
        hofInterval = null;
    }
    
    db.closeDb();
    console.log('[Collector] Stopped.');
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