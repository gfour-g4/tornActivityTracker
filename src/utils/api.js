

const storage = require('./storage');
const config = require('../config');
const { apiLog } = require('./logger');

const API_BASE = 'https://api.torn.com';

const apiCallLog = new Map();

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanOldCalls(key) {
    const now = Date.now();
    const calls = apiCallLog.get(key) || [];
    const recentCalls = calls.filter(t => now - t < config.api.rateLimitWindowMs);
    apiCallLog.set(key, recentCalls);
    return recentCalls;
}

function getCallCount(key) {
    return cleanOldCalls(key).length;
}

function logCall(key) {
    const calls = apiCallLog.get(key) || [];
    calls.push(Date.now());
    apiCallLog.set(key, calls);
}

function getKeyRateLimit(key) {
    return storage.getKeyRateLimit(key);
}

function getTimeUntilSlotAvailable(key) {
    const calls = cleanOldCalls(key);
    const rateLimit = getKeyRateLimit(key);
    
    if (calls.length < rateLimit) {
        return 0;
    }
    const oldestCall = Math.min(...calls);
    const timeUntilExpiry = (oldestCall + config.api.rateLimitWindowMs) - Date.now();
    return Math.max(0, timeUntilExpiry + 100);
}

function findAvailableKey(excludeKeys = []) {
    const storageConfig = storage.loadConfig();
    
    if (storageConfig.apikeys.length === 0) {
        return { key: null, waitTime: 0 };
    }
    
    const now = Date.now();
    storageConfig.failedKeys = storageConfig.failedKeys || {};
    
    // Clean up old failures
    let changed = false;
    for (const key of Object.keys(storageConfig.failedKeys)) {
        if (now - storageConfig.failedKeys[key] > config.api.failedKeyTimeoutMs) {
            delete storageConfig.failedKeys[key];
            changed = true;
        }
    }
    if (changed) {
        storage.saveConfig(storageConfig);
    }
    
    // Get available keys
    const availableKeys = storageConfig.apikeys.filter(entry => 
        !excludeKeys.includes(entry.key) && !storageConfig.failedKeys[entry.key]
    );
    
    if (availableKeys.length === 0) {
        if (Object.keys(storageConfig.failedKeys).length > 0) {
            storageConfig.failedKeys = {};
            storage.saveConfig(storageConfig);
            const entry = storageConfig.apikeys.find(e => !excludeKeys.includes(e.key));
            return { key: entry?.key || null, waitTime: 0 };
        }
        return { key: null, waitTime: 0 };
    }
    
    let bestKey = null;
    let lowestWait = Infinity;
    let lowestUsage = Infinity;
    
    for (const entry of availableKeys) {
        const usage = getCallCount(entry.key);
        const rateLimit = entry.rateLimit;
        const usageRatio = usage / rateLimit; // Normalize by rate limit
        const waitTime = getTimeUntilSlotAvailable(entry.key);
        
        if (waitTime === 0 && usageRatio < lowestUsage) {
            lowestUsage = usageRatio;
            bestKey = entry.key;
            lowestWait = 0;
        } else if (lowestWait > 0 && waitTime < lowestWait) {
            lowestWait = waitTime;
            bestKey = entry.key;
        }
    }
    
    if (!bestKey && availableKeys.length > 0) {
        bestKey = availableKeys[0].key;
        lowestWait = getTimeUntilSlotAvailable(bestKey);
    }
    
    return { key: bestKey, waitTime: lowestWait };
}

async function fetchWithRetry(url, context = '', usedKeys = [], attempt = 1) {
    const { key: apiKey, waitTime } = findAvailableKey(usedKeys);
    
    if (!apiKey) {
        throw new Error('No API keys available. All keys may have failed.');
    }
    
    if (waitTime > 0) {
        const keyHint = apiKey.slice(-4);
        apiLog.debug({ 
            waitMs: waitTime, 
            key: `...${keyHint}`, 
            context 
        }, 'Waiting for rate limit');
        await sleep(waitTime);
    }
    
    const separator = url.includes('?') ? '&' : '?';
    const fullUrl = `${url}${separator}key=${apiKey}`;
    
    try {
        logCall(apiKey);
        
        const response = await fetch(fullUrl);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.error) {
            const errorCode = data.error.code;
            const errorMsg = data.error.error;
            
            if ([1, 2, 10, 13].includes(errorCode)) {
                apiLog.warn({ errorCode, errorMsg }, 'Key error, trying next key');
                storage.markKeyFailed(apiKey);
                
                if (attempt < config.api.retryAttempts && usedKeys.length + 1 < storage.loadConfig().apikeys.length) {
                    await sleep(config.api.retryDelayMs);
                    return fetchWithRetry(url, context, [...usedKeys, apiKey], attempt + 1);
                }
                
                throw new Error(`All API keys failed. Last error: ${errorMsg}`);
            }
            
            if (errorCode === 5) {
                apiLog.warn('Torn rate limit hit, waiting 30 seconds');
                await sleep(30000);
                return fetchWithRetry(url, context, usedKeys, attempt);
            }
            
            if (errorCode === 8) {
                throw new Error('IP is banned from Torn API. Please contact Torn support.');
            }
            
            throw new Error(`Torn API error: ${errorMsg}`);
        }
        
        storage.markKeyWorking(apiKey);
        return data;
        
    } catch (error) {
        if (error.message.includes('fetch') || 
            error.message.includes('network') || 
            error.message.includes('ETIMEDOUT') ||
            error.message.includes('ECONNREFUSED') ||
            error.message.includes('ENOTFOUND')) {
            
            apiLog.error({ error: error.message }, 'Network error, trying next key');
            storage.markKeyFailed(apiKey);
            
            if (attempt < config.api.retryAttempts) {
                await sleep(config.api.retryDelayMs);
                return fetchWithRetry(url, context, [...usedKeys, apiKey], attempt + 1);
            }
        }
        
        throw error;
    }
}

async function fetchFaction(factionId) {
    const url = `${API_BASE}/faction/${factionId}?selections=basic`;
    return fetchWithRetry(url, `Faction ${factionId}`);
}

async function fetchHOFPage(offset = 0, limit = 100) {
    const url = `${API_BASE}/v2/torn/factionhof?cat=rank&limit=${limit}&offset=${offset}`;
    return fetchWithRetry(url, `HOF page offset=${offset}`);
}

async function fetchAllHOF(progressCallback = null) {
    const allFactions = [];
    let offset = 0;
    const limit = 100;
    let hasMore = true;
    let page = 0;
    
    while (hasMore) {
        page++;
        if (progressCallback) {
            progressCallback(page, allFactions.length);
        }
        
        const data = await fetchHOFPage(offset, limit);
        
        if (!data.factionhof || data.factionhof.length === 0) {
            hasMore = false;
        } else {
            allFactions.push(...data.factionhof);
            offset += limit;
            
            if (!data._metadata?.links?.next) {
                hasMore = false;
            }
            
            if (allFactions.length >= config.hof.maxFactions) {
                hasMore = false;
            }
            
            await sleep(config.hof.pageFetchDelayMs);
        }
    }
    
    return allFactions;
}

function processActivitySnapshot(factionData, pollTimestamp) {
    const activeMembers = [];
    const allMemberIds = [];
    const members = factionData.members || {};
    
    // Calculate the start of the current 15-min slot
    const slotDurationSeconds = 15 * 60;
    const slotStart = Math.floor(pollTimestamp / slotDurationSeconds) * slotDurationSeconds;
    
    for (const [memberId, memberData] of Object.entries(members)) {
        const id = parseInt(memberId);
        allMemberIds.push(id);
        
        const lastAction = memberData.last_action?.timestamp || 0;
        
        // Active if their last action is within the current 15-min slot
        if (lastAction >= slotStart) {
            activeMembers.push(id);
        }
    }
    
    return {
        active: activeMembers,
        total: Object.keys(members).length,
        allMemberIds,
        members
    };
}

function getRateLimitStatus() {
    const storageConfig = storage.loadConfig();
    const status = {};
    
    for (const entry of storageConfig.apikeys) {
        const masked = `...${entry.key.slice(-4)}`;
        const calls = getCallCount(entry.key);
        const rateLimit = entry.rateLimit;
        const isFailed = storageConfig.failedKeys && storageConfig.failedKeys[entry.key];
        
        status[masked] = {
            calls,
            limit: rateLimit,
            available: rateLimit - calls,
            failed: !!isFailed
        };
    }
    
    return status;
}

function estimateCollectionTime(factionCount) {
    const storageConfig = storage.loadConfig();
    
    if (storageConfig.apikeys.length === 0) return Infinity;
    
    // Sum up all rate limits
    const totalCallsPerMinute = storageConfig.apikeys.reduce(
        (sum, entry) => sum + entry.rateLimit, 
        0
    );
    
    const minutes = factionCount / totalCallsPerMinute;
    
    return Math.ceil(minutes * 60);
}

function clearRateLimitLog() {
    apiCallLog.clear();
    apiLog.info('Rate limit log cleared');
}

const RATE_LIMIT_PER_KEY = config.api.defaultCallsPerKeyPerMinute;

module.exports = {
    fetchFaction,
    fetchHOFPage,
    fetchAllHOF,
    processActivitySnapshot,
    getRateLimitStatus,
    estimateCollectionTime,
    clearRateLimitLog,
    RATE_LIMIT_PER_KEY
};