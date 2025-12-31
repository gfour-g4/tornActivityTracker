class Cache {
    constructor(options = {}) {
        this.cache = new Map();
        this.ttl = options.ttl || 5 * 60 * 1000; // 5 minutes default
        this.maxSize = options.maxSize || 100;
        this.cleanupInterval = options.cleanupInterval || 60 * 1000; // 1 minute
        
        // Start cleanup timer
        this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupInterval);
    }
    
    get(key) {
        const item = this.cache.get(key);
        
        if (!item) return null;
        
        if (Date.now() > item.expires) {
            this.cache.delete(key);
            return null;
        }
        
        // Update access time for LRU
        item.lastAccess = Date.now();
        return item.value;
    }
    
    set(key, value, ttl = this.ttl) {
        // Evict if at max size
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

// Pre-configured caches
const heatmapCache = new Cache({ ttl: 5 * 60 * 1000, maxSize: 200 }); // 5 min
const aggregateCache = new Cache({ ttl: 15 * 60 * 1000, maxSize: 500 }); // 15 min
const memberCache = new Cache({ ttl: 60 * 60 * 1000, maxSize: 1000 }); // 1 hour

module.exports = {
    Cache,
    heatmapCache,
    aggregateCache,
    memberCache
};