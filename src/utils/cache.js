
const config = require('../config');

class Cache {
    constructor(options = {}) {
        this.cache = new Map();
        this.ttl = options.ttl || 5 * 60 * 1000;
        this.maxSize = options.maxSize || 100;
        this.cleanupInterval = options.cleanupInterval || 60 * 1000;
        
        this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupInterval);
    }
    
    get(key) {
        const item = this.cache.get(key);
        
        if (!item) return null;
        
        if (Date.now() > item.expires) {
            this.cache.delete(key);
            return null;
        }
        
        item.lastAccess = Date.now();
        return item.value;
    }
    
    set(key, value, ttl = this.ttl) {
        if (this.cache.size >= this.maxSize) {
            this.evictLRU();
        }
        
        this.cache.set(key, {
            value,
            expires: Date.now() + ttl,
            lastAccess: Date.now()
        });
    }
    
    has(key) {
        return this.get(key) !== null;
    }
    
    delete(key) {
        this.cache.delete(key);
    }
    
    clear() {
        this.cache.clear();
    }
    
    cleanup() {
        const now = Date.now();
        
        for (const [key, item] of this.cache) {
            if (now > item.expires) {
                this.cache.delete(key);
            }
        }
    }
    
    evictLRU() {
        let oldestKey = null;
        let oldestTime = Infinity;
        
        for (const [key, item] of this.cache) {
            if (item.lastAccess < oldestTime) {
                oldestTime = item.lastAccess;
                oldestKey = key;
            }
        }
        
        if (oldestKey) {
            this.cache.delete(oldestKey);
        }
    }
    
    size() {
        return this.cache.size;
    }
    
    stop() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }
}

// Pre-configured caches using config
const heatmapCache = new Cache({ 
    ttl: config.cache.heatmapTtlMs, 
    maxSize: config.cache.heatmapMaxSize 
});

const aggregateCache = new Cache({ 
    ttl: config.cache.aggregateTtlMs, 
    maxSize: config.cache.aggregateMaxSize 
});

const memberCache = new Cache({ 
    ttl: config.cache.memberTtlMs, 
    maxSize: config.cache.memberMaxSize 
});

module.exports = {
    Cache,
    heatmapCache,
    aggregateCache,
    memberCache
};