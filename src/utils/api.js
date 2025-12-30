const storage = require('./storage');

const API_BASE = 'https://api.torn.com';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

// Rate limiting: 20 calls per minute per key
const RATE_LIMIT_PER_KEY = 20;
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute

// Track API calls per key: { key: [timestamp1, timestamp2, ...] }
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
    // Find when the oldest call will expire
    const oldestCall = Math.min(...calls);
    const timeUntilExpiry = (oldestCall + RATE_LIMIT_WINDOW) - Date.now();
    return Math.max(0, timeUntilExpiry + 100); // Add 100ms buffer
}

async function waitForRateLimit(key) {
    const waitTime = getTimeUntilSlotAvailable(key);
    if (waitTime > 0) {
        console.log(`[API] Rate limit for key ...${key.slice(-4)}: waiting ${Math.ceil(waitTime / 1000)}s`);
        await sleep(waitTime);
    }
}

function findBestKey(excludeKeys = []) {
    const config = storage.loadConfig();
    
    if (config.apikeys.length === 0) {
        return null;
    }
    
    const now = Date.now();
    config.failedKeys = config.failedKeys || {};
    
    // Clean up old failures (retry after 5 minutes)
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
    
    // Find available keys (not excluded, not failed)
    const availableKeys = config.apikeys.filter(k => 
        !excludeKeys.includes(k) && !config.failedKeys[k]
    );
    
    if (availableKeys.length === 0) {
        // All keys failed or excluded, reset failed keys and try first available
        if (Object.keys(config.failedKeys).length > 0) {
            config.failedKeys = {};
            storage.saveConfig(config);
            return config.apikeys.find(k => !excludeKeys.includes(k)) || null;
        }
        return null;
    }
    
    // Find key with lowest current usage (most capacity remaining)
    let bestKey = null;
    let lowestUsage = Infinity;
    
    for (const key of availableKeys) {
        const usage = getCallCount(key);
        if (usage < lowestUsage) {
            lowestUsage = usage;
            bestKey = key;
        }
    }
    
    return bestKey;
}

async function fetchWithRetry(url, usedKeys = [], attempt = 1) {
    const apiKey = findBestKey(usedKeys);
    
    if (!apiKey) {
        throw new Error('No API keys available. All keys may have failed or be rate limited.');
    }
    
    // Wait for rate limit if needed
    await waitForRateLimit(apiKey);
    
    const fullUrl = `${url}&key=${apiKey}`;
    
    try {
        // Log the call before making it
        logCall(apiKey);
        
        const response = await fetch(fullUrl);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.error) {
            const errorCode = data.error.code;
            const errorMsg = data.error.error;
            
            // Key-related errors - try next key
            if ([1, 2, 10, 13].includes(errorCode)) {
                console.error(`[API] Key error (${errorCode}): ${errorMsg}. Trying next key...`);
                storage.markKeyFailed(apiKey);
                
                if (attempt < MAX_RETRIES && usedKeys.length + 1 < storage.loadConfig().apikeys.length) {
                    await sleep(RETRY_DELAY);
                    return fetchWithRetry(url, [...usedKeys, apiKey], attempt + 1);
                }
                
                throw new Error(`All API keys failed. Last error: ${errorMsg}`);
            }
            
            // Rate limit from Torn's side - wait and retry
            if (errorCode === 5) {
                console.log('[API] Torn rate limit hit. Waiting 30 seconds...');
                await sleep(30000);
                return fetchWithRetry(url, usedKeys, attempt);
            }
            
            // IP ban - stop everything
            if (errorCode === 8) {
                throw new Error('IP is banned from Torn API. Please contact Torn support.');
            }
            
            // Other errors - don't retry
            throw new Error(`Torn API error: ${errorMsg}`);
        }
        
        // Success - mark key as working
        storage.markKeyWorking(apiKey);
        return data;
        
    } catch (error) {
        // Network errors - try next key
        if (error.message.includes('fetch') || 
            error.message.includes('network') || 
            error.message.includes('ETIMEDOUT') ||
            error.message.includes('ECONNREFUSED') ||
            error.message.includes('ENOTFOUND')) {
            
            console.error(`[API] Network error: ${error.message}. Trying next key...`);
            storage.markKeyFailed(apiKey);
            
            if (attempt < MAX_RETRIES) {
                await sleep(RETRY_DELAY);
                return fetchWithRetry(url, [...usedKeys, apiKey], attempt + 1);
            }
        }
        
        throw error;
    }
}

async function fetchFaction(factionId) {
    const url = `${API_BASE}/faction/${factionId}?selections=basic`;
    return fetchWithRetry(url);
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

// Get rate limit status for all keys
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

// Calculate estimated time to collect N factions
function estimateCollectionTime(factionCount) {
    const config = storage.loadConfig();
    const keyCount = config.apikeys.length;
    
    if (keyCount === 0) return Infinity;
    
    const totalCallsPerMinute = keyCount * RATE_LIMIT_PER_KEY;
    const minutes = factionCount / totalCallsPerMinute;
    
    return Math.ceil(minutes * 60); // Return seconds
}

module.exports = {
    fetchFaction,
    processActivitySnapshot,
    getRateLimitStatus,
    estimateCollectionTime,
    RATE_LIMIT_PER_KEY
};