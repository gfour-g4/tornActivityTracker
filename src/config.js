module.exports = {
    // Data collection
    collection: {
        intervalMs: 15 * 60 * 1000,           // 15 minutes
        dataRetentionDays: 30,
        activeThresholdSeconds: 900,           // 15 min = "active"
    },
    
    // API rate limiting
    api: {
        callsPerKeyPerMinute: 20,
        maxConcurrency: 10,
        retryAttempts: 3,
        retryDelayMs: 1000,
        rateLimitWindowMs: 60 * 1000,
        failedKeyTimeoutMs: 5 * 60 * 1000,     // 5 minutes
    },
    
    // Hall of Fame
    hof: {
        updateIntervalMs: 7 * 24 * 60 * 60 * 1000,  // 7 days
        trackedRanks: ['diamond', 'platinum'],
        maxFactions: 5000,
        pageFetchDelayMs: 500,
    },
    
    // Caching
    cache: {
        heatmapTtlMs: 5 * 60 * 1000,          // 5 minutes
        aggregateTtlMs: 15 * 60 * 1000,       // 15 minutes
        memberTtlMs: 60 * 60 * 1000,          // 1 hour
        heatmapMaxSize: 200,
        aggregateMaxSize: 500,
        memberMaxSize: 1000,
    },
    
    // Discord presence
    presence: {
        updateIntervalMs: 5 * 60 * 1000,      // 5 minutes
    },
    
    // Encryption
    crypto: {
        algorithm: 'aes-256-gcm',
    }
};