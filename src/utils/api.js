const storage = require('./storage');

const API_BASE = 'https://api.torn.com';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

// Rate limiting: 20 calls per minute per key
const RATE_LIMIT_PER_KEY = 20;
const RATE_LIMIT_WINDOW = 60 * 1000;

const apiCallLog = new Map();

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanOldCalls(key) {
    const now = Date.now();
    const calls = apiCallLog.get(key) || [];
    const recentCalls = calls.filter(t => now - t < RATE_LIMIT_WINDOW);
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

function getTimeUntilSlotAvailable(key) {
    const calls = cleanOldCalls(key);
    if (calls.length < RATE_LIMIT_PER_KEY) {
        return 0;
    }
    const oldestCall = Math.min(...calls);
    const timeUntilExpiry = (oldestCall + RATE_LIMIT_WINDOW) - Date.now();
    return Math.max(0, timeUntilExpiry + 100);
}

function findAvailableKey(excludeKeys = []) {
    const config = storage.loadConfig();
    
    if (config.apikeys.length === 0) {
        return { key: null, waitTime: 0 };
    }
    
    const now = Date.now();
    config.failedKeys = config.failedKeys || {};
    
    // Clean up old failures
    let changed = false;
    for (const key of Object.keys(config.failedKeys)) {
        if (now - config.failedKeys[key] > 5 * 60 * 1000) {
            delete config.failedKeys[key];
            changed = true;
        }
    }
    if (changed) {
        storage.saveConfig(config);
    }
    
    // Find available keys
    const availableKeys = config.apikeys.filter(k => 
        !excludeKeys.includes(k) && !config.failedKeys[k]
    );
    
    if (availableKeys.length === 0) {
        if (Object.keys(config.failedKeys).length > 0) {
            config.failedKeys = {};
            storage.saveConfig(config);
            const key = config.apikeys.find(k => !excludeKeys.includes(k));
            return { key: key || null, waitTime: 0 };
        }
        return { key: null, waitTime: 0 };
    }
    
    // Find key with most capacity (lowest usage)
    let bestKey = null;
    let lowestWait = Infinity;
    let lowestUsage = Infinity;
    
    for (const key of availableKeys) {
        const usage = getCallCount(key);
        const waitTime = getTimeUntilSlotAvailable(key);
        
        // Prefer keys that don't need waiting
        if (waitTime === 0 && usage < lowestUsage) {
            lowestUsage = usage;
            bestKey = key;
            lowestWait = 0;
        } else if (lowestWait > 0 && waitTime < lowestWait) {
            // If all keys need waiting, pick the one with shortest wait
            lowestWait = waitTime;
            bestKey = key;
        }
    }
    
    // If no key found without wait, use the one with shortest wait
    if (!bestKey && availableKeys.length > 0) {
        bestKey = availableKeys[0];
        lowestWait = getTimeUntilSlotAvailable(bestKey);
    }
    
    return { key: bestKey, waitTime: lowestWait };
}

async function fetchWithRetry(url, context = '', usedKeys = [], attempt = 1) {
    const { key: apiKey, waitTime } = findAvailableKey(usedKeys);
    
    if (!apiKey) {
        throw new Error('No API keys available. All keys may have failed.');
    }
    
    // Wait if needed
    if (waitTime > 0) {
        const keyHint = apiKey.slice(-4);
        const waitSec = Math.ceil(waitTime / 1000);
        console.log(`[API] Waiting ${waitSec}s for rate limit (key ...${keyHint})${context ? ` - ${context}` : ''}`);
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
                console.error(`[API] Key error (${errorCode}): ${errorMsg}. Trying next key...`);
                storage.markKeyFailed(apiKey);
                
                if (attempt < MAX_RETRIES && usedKeys.length + 1 < storage.loadConfig().apikeys.length) {
                    await sleep(RETRY_DELAY);
                    return fetchWithRetry(url, context, [...usedKeys, apiKey], attempt + 1);
                }
                
                throw new Error(`All API keys failed. Last error: ${errorMsg}`);
            }
            
            if (errorCode === 5) {
                console.log('[API] Torn rate limit hit. Waiting 30 seconds...');
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
            
            console.error(`[API] Network error: ${error.message}. Trying next key...`);
            storage.markKeyFailed(apiKey);
            
            if (attempt < MAX_RETRIES) {
                await sleep(RETRY_DELAY);
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
            
            if (allFactions.length >= 5000) {
                hasMore = false;
            }
            
            // Delay between pages
            await sleep(500);
        }
    }
    
    return allFactions;
}

function processActivitySnapshot(factionData, pollTimestamp) {
    const activeMembers = [];
    const allMemberIds = [];
    const members = factionData.members || {};
    
    for (const [memberId, memberData] of Object.entries(members)) {
        const id = parseInt(memberId);
        allMemberIds.push(id);
        
        const lastAction = memberData.last_action?.timestamp || 0;
        const timeDiff = pollTimestamp - lastAction;
        
        if (timeDiff <= 900) {
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
    const config = storage.loadConfig();
    const status = {};
    
    for (const key of config.apikeys) {
        const masked = `...${key.slice(-4)}`;
        const calls = getCallCount(key);
        const isFailed = config.failedKeys && config.failedKeys[key];
        
        status[masked] = {
            calls,
            limit: RATE_LIMIT_PER_KEY,
            available: RATE_LIMIT_PER_KEY - calls,
            failed: !!isFailed
        };
    }
    
    return status;
}

function estimateCollectionTime(factionCount) {
    const config = storage.loadConfig();
    const keyCount = config.apikeys.length;
    
    if (keyCount === 0) return Infinity;
    
    const totalCallsPerMinute = keyCount * RATE_LIMIT_PER_KEY;
    const minutes = factionCount / totalCallsPerMinute;
    
    return Math.ceil(minutes * 60);
}

// Clear rate limit tracking (useful for debugging)
function clearRateLimitLog() {
    apiCallLog.clear();
    console.log('[API] Rate limit log cleared');
}

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