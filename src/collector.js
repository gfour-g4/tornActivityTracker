const api = require('./utils/api');
const storage = require('./utils/storage');
const hof = require('./utils/hof');
const db = require('./database');
const config = require('./config');
const { collectorLog } = require('./utils/logger');

let collectorTimeout = null;
let hofInterval = null;
let isCollecting = false;
let isShuttingDown = false;
let lastCollectionStats = null;

async function collectFactionData(factionId, slotTimestamp) {
    try {
        const factionData = await api.fetchFaction(factionId);
        const { active, total, allMemberIds, members } = api.processActivitySnapshot(factionData, slotTimestamp);
        
        storage.updateMemberNames(members);
        
        // Use slot timestamp, not current time
        storage.addSnapshot(
            factionId, 
            factionData.name, 
            slotTimestamp, 
            active, 
            total,
            allMemberIds
        );
        
        return { success: true, factionId, name: factionData.name, active: active.length, total };
    } catch (error) {
        return { success: false, factionId, error: error.message };
    }
}

function getCurrentSlotTimestamp() {
    const now = Math.floor(Date.now() / 1000);
    const slotDuration = 15 * 60; // 15 minutes
    return Math.floor(now / slotDuration) * slotDuration;
}

function getNextSlotTime() {
    const now = Date.now();
    const slotDurationMs = 15 * 60 * 1000;
    const currentSlotStart = Math.floor(now / slotDurationMs) * slotDurationMs;
    const nextSlotStart = currentSlotStart + slotDurationMs;
    
    // Add a small delay (30 seconds) after slot starts to let activity settle
    return nextSlotStart + 30 * 1000;
}

async function collectAllFactions() {
    if (isCollecting) {
        collectorLog.warn('Collection already in progress, skipping...');
        return null;
    }
    
    if (isShuttingDown) {
        collectorLog.info('Shutdown in progress, skipping collection');
        return null;
    }
    
    isCollecting = true;
    
    const storageConfig = storage.loadConfig();
    
    if (storageConfig.factions.length === 0) {
        collectorLog.info('No factions configured to track');
        isCollecting = false;
        scheduleNextCollection();
        return null;
    }
    
    if (storageConfig.apikeys.length === 0) {
        collectorLog.warn('No API keys configured');
        isCollecting = false;
        scheduleNextCollection();
        return null;
    }
    
    const slotTimestamp = getCurrentSlotTimestamp();
    const startTime = Date.now();
    const keyCount = storageConfig.apikeys.length;
    const concurrency = Math.min(keyCount * 2, config.api.maxConcurrency);
    
    collectorLog.info({
        factions: storageConfig.factions.length,
        apiKeys: keyCount,
        concurrency,
        slot: new Date(slotTimestamp * 1000).toISOString()
    }, 'Starting parallel collection');
    
    const results = {
        success: 0,
        failed: 0,
        skipped: 0,
        errors: [],
        startTime,
        endTime: null,
        slotTimestamp
    };
    
    // Filter out factions already collected for this slot
    const factionsToCollect = [];
    for (const factionId of storageConfig.factions) {
        if (db.hasSnapshotForSlot(factionId, slotTimestamp)) {
            results.skipped++;
        } else {
            factionsToCollect.push(factionId);
        }
    }
    
    if (results.skipped > 0) {
        collectorLog.info({ skipped: results.skipped }, 'Skipped already collected factions');
    }
    
    if (factionsToCollect.length === 0) {
        collectorLog.info('All factions already collected for this slot');
        isCollecting = false;
        scheduleNextCollection();
        return results;
    }
    
    const factionQueue = [...factionsToCollect];
    let processedCount = 0;
    const totalToProcess = factionQueue.length;
    
    async function processNext() {
        while (factionQueue.length > 0 && !isShuttingDown) {
            const factionId = factionQueue.shift();
            const result = await collectFactionData(factionId, slotTimestamp);
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
        skipped: results.skipped,
        durationSeconds: Math.round(duration),
        interrupted: isShuttingDown
    }, 'Collection complete');
    
    lastCollectionStats = results;
    isCollecting = false;
    
    if (!isShuttingDown) {
        scheduleNextCollection();
    }
    
    return results;
}

function scheduleNextCollection() {
    if (collectorTimeout) {
        clearTimeout(collectorTimeout);
    }
    
    if (isShuttingDown) {
        return;
    }
    
    const nextTime = getNextSlotTime();
    const delay = nextTime - Date.now();
    
    collectorLog.debug({
        nextCollection: new Date(nextTime).toISOString(),
        delayMs: delay
    }, 'Scheduled next collection');
    
    collectorTimeout = setTimeout(collectAllFactions, delay);
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
    if (collectorTimeout) {
        collectorLog.warn('Collector already running');
        return;
    }
    
    isShuttingDown = false;
    
    const storageConfig = storage.loadConfig();
    
    collectorLog.info({
        factions: storageConfig.factions.length,
        apiKeys: storageConfig.apikeys.length,
        intervalMinutes: 15
    }, 'Starting collector');
    
    // Initialize database
    db.getDb();
    collectorLog.info('Database initialized');
    
    // Update HOF on startup if needed
    updateHOFIfNeeded();
    
    // Check if we should collect now or wait for next slot
    const currentSlot = getCurrentSlotTimestamp();
    const storageConfigCheck = storage.loadConfig();
    
    let needsImmediateCollection = false;
    for (const factionId of storageConfigCheck.factions) {
        if (!db.hasSnapshotForSlot(factionId, currentSlot)) {
            needsImmediateCollection = true;
            break;
        }
    }
    
    if (needsImmediateCollection) {
        collectorLog.info('Missing data for current slot, collecting now');
        collectAllFactions();
    } else {
        collectorLog.info('Current slot already collected, waiting for next slot');
        scheduleNextCollection();
    }
    
    // Check HOF daily
    hofInterval = setInterval(updateHOFIfNeeded, 24 * 60 * 60 * 1000);
}

async function stopCollector() {
    isShuttingDown = true;
    
    if (collectorTimeout) {
        clearTimeout(collectorTimeout);
        collectorTimeout = null;
    }
    
    if (hofInterval) {
        clearInterval(hofInterval);
        hofInterval = null;
    }
    
    // Wait for current collection to finish
    if (isCollecting) {
        collectorLog.info('Waiting for current collection to finish...');
        
        const maxWait = 60000; // 60 seconds max
        const startWait = Date.now();
        
        while (isCollecting && (Date.now() - startWait) < maxWait) {
            await new Promise(r => setTimeout(r, 500));
        }
        
        if (isCollecting) {
            collectorLog.warn('Collection did not finish in time, forcing shutdown');
        } else {
            collectorLog.info('Collection finished, proceeding with shutdown');
        }
    }
    
    db.closeDb();
    collectorLog.info('Collector stopped');
}

function getCollectorStatus() {
    const storageConfig = storage.loadConfig();
    
    return {
        running: collectorTimeout !== null || isCollecting,
        collecting: isCollecting,
        shuttingDown: isShuttingDown,
        factionCount: storageConfig.factions.length,
        keyCount: storageConfig.apikeys.length,
        rateLimit: config.api.callsPerKeyPerMinute,
        estimatedCollectionTime: api.estimateCollectionTime(storageConfig.factions.length),
        lastCollection: lastCollectionStats,
        rateLimitStatus: api.getRateLimitStatus(),
        nextSlot: new Date(getNextSlotTime()).toISOString()
    };
}

module.exports = {
    startCollector,
    stopCollector,
    collectAllFactions,
    collectFactionData,
    getCollectorStatus
};