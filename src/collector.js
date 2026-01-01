
const api = require('./utils/api');
const storage = require('./utils/storage');
const hof = require('./utils/hof');
const db = require('./database');
const config = require('./config');
const { collectorLog } = require('./utils/logger');

let collectorInterval = null;
let hofInterval = null;
let isCollecting = false;
let lastCollectionStats = null;

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
        collectorLog.warn('Collection already in progress, skipping...');
        return null;
    }
    
    isCollecting = true;
    
    const storageConfig = storage.loadConfig();
    
    if (storageConfig.factions.length === 0) {
        collectorLog.info('No factions configured to track');
        isCollecting = false;
        return null;
    }
    
    if (storageConfig.apikeys.length === 0) {
        collectorLog.warn('No API keys configured');
        isCollecting = false;
        return null;
    }
    
    const startTime = Date.now();
    const keyCount = storageConfig.apikeys.length;
    const concurrency = Math.min(keyCount * 2, config.api.maxConcurrency);
    
    collectorLog.info({
        factions: storageConfig.factions.length,
        apiKeys: keyCount,
        concurrency
    }, 'Starting parallel collection');
    
    const results = {
        success: 0,
        failed: 0,
        errors: [],
        startTime,
        endTime: null
    };
    
    const factionQueue = [...storageConfig.factions];
    let processedCount = 0;
    const totalToProcess = factionQueue.length;
    
    async function processNext() {
        while (factionQueue.length > 0) {
            const factionId = factionQueue.shift();
            const result = await collectFactionData(factionId);
            processedCount++;
            
            if (result.success) {
                results.success++;
                if (totalToProcess <= 20 || processedCount % 50 === 0) {
                    collectorLog.debug({
                        progress: `${processedCount}/${totalToProcess}`,
                        faction: result.name,
                        active: result.active,
                        total: result.total
                    }, 'Faction collected');
                }
            } else {
                results.failed++;
                results.errors.push({ factionId, error: result.error });
                collectorLog.error({
                    progress: `${processedCount}/${totalToProcess}`,
                    factionId,
                    error: result.error
                }, 'Faction collection failed');
            }
        }
    }
    
    const workers = [];
    for (let i = 0; i < concurrency; i++) {
        workers.push(processNext());
    }
    
    await Promise.all(workers);
    
    results.endTime = Date.now();
    const duration = (results.endTime - results.startTime) / 1000;
    
    collectorLog.info({
        success: results.success,
        failed: results.failed,
        durationSeconds: Math.round(duration)
    }, 'Collection complete');
    
    lastCollectionStats = results;
    isCollecting = false;
    
    return results;
}

async function updateHOFIfNeeded() {
    if (hof.isHOFCacheStale()) {
        collectorLog.info('HOF cache is stale, updating...');
        try {
            await hof.updateHOFCache();
        } catch (error) {
            collectorLog.error({ error: error.message }, 'Failed to update HOF cache');
        }
    }
}

function startCollector() {
    if (collectorInterval) {
        collectorLog.warn('Collector already running');
        return;
    }
    
    const storageConfig = storage.loadConfig();
    
    collectorLog.info({
        factions: storageConfig.factions.length,
        apiKeys: storageConfig.apikeys.length,
        intervalMinutes: config.collection.intervalMs / 60000
    }, 'Starting collector');
    
    // Initialize database
    db.getDb();
    collectorLog.info('Database initialized');
    
    // Update HOF on startup if needed
    updateHOFIfNeeded();
    
    // Collect immediately on start
    collectAllFactions();
    
    // Then at configured interval
    collectorInterval = setInterval(collectAllFactions, config.collection.intervalMs);
    
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
    collectorLog.info('Collector stopped');
}

function getCollectorStatus() {
    const storageConfig = storage.loadConfig();
    
    return {
        running: collectorInterval !== null,
        collecting: isCollecting,
        factionCount: storageConfig.factions.length,
        keyCount: storageConfig.apikeys.length,
        rateLimit: config.api.callsPerKeyPerMinute,
        estimatedCollectionTime: api.estimateCollectionTime(storageConfig.factions.length),
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

