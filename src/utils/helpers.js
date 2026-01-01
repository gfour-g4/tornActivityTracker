
const config = require('../config');

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseDaysFilter(daysInput) {
    if (!daysInput || daysInput === 'all') {
        return [0, 1, 2, 3, 4, 5, 6];
    }
    
    if (daysInput === 'weekday') {
        return [1, 2, 3, 4, 5];
    }
    
    if (daysInput === 'weekend') {
        return [0, 6];
    }
    
    const days = daysInput.toLowerCase().split(',').map(d => d.trim());
    const indices = [];
    
    for (const day of days) {
        const index = DAY_NAMES.indexOf(day);
        if (index !== -1 && !indices.includes(index)) {
            indices.push(index);
        }
    }
    
    return indices.length > 0 ? indices.sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6];
}

function getHourFromTimestamp(timestamp) {
    const date = new Date(timestamp * 1000);
    return date.getUTCHours();
}

function get15MinSlotInHour(timestamp) {
    const date = new Date(timestamp * 1000);
    return Math.floor(date.getUTCMinutes() / 15);
}

function getDayOfWeek(timestamp) {
    const date = new Date(timestamp * 1000);
    return date.getUTCDay();
}

function formatTimeSlot(index, granularity) {
    if (granularity === '15min') {
        const hours = Math.floor(index / 4);
        const minutes = (index % 4) * 15;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }
    
    return `${index.toString().padStart(2, '0')}:00`;
}

function getThirtyDaysAgo() {
    return Math.floor(Date.now() / 1000) - (config.collection.dataRetentionDays * 24 * 60 * 60);
}

function getDaysAgo(days) {
    return Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);
}

function getWeekId(timestamp, referenceTimestamp) {
    const refDate = new Date(referenceTimestamp * 1000);
    const targetDate = new Date(timestamp * 1000);
    
    const refWeekStart = new Date(refDate);
    refWeekStart.setUTCHours(0, 0, 0, 0);
    refWeekStart.setUTCDate(refWeekStart.getUTCDate() - refWeekStart.getUTCDay());
    
    const targetWeekStart = new Date(targetDate);
    targetWeekStart.setUTCHours(0, 0, 0, 0);
    targetWeekStart.setUTCDate(targetWeekStart.getUTCDate() - targetWeekStart.getUTCDay());
    
    const diffMs = refWeekStart.getTime() - targetWeekStart.getTime();
    const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
    
    return diffWeeks;
}

function getUniqueWeeks(snapshots, referenceTimestamp) {
    const weeks = new Set();
    for (const snapshot of snapshots) {
        const timestamp = snapshot.t || snapshot.timestamp;
        weeks.add(getWeekId(timestamp, referenceTimestamp));
    }
    return weeks.size;
}

/**
 * Resolve multiple factions from comma-separated input
 * @param {string} input - Comma-separated faction names or IDs
 * @param {object} hof - HOF module reference
 * @param {object} storage - Storage module reference
 * @returns {Array<{id: number, name: string, members: number|null}>}
 */
function resolveMultipleFactions(input, hof, storage) {
    const parts = input.split(',').map(p => p.trim()).filter(p => p.length > 0);
    const resolved = [];
    const seen = new Set();
    
    for (const part of parts) {
        // Try as ID first
        const asNumber = parseInt(part);
        if (!isNaN(asNumber) && asNumber.toString() === part) {
            if (!seen.has(asNumber)) {
                const hofData = hof.getFactionFromHOF(asNumber);
                const storageData = storage.loadFactionData(asNumber);
                
                resolved.push({
                    id: asNumber,
                    name: hofData?.name || storageData?.name || `Faction ${asNumber}`,
                    members: hofData?.members || null
                });
                seen.add(asNumber);
            }
            continue;
        }
        
        // Try as name
        const hofResults = hof.searchHOFByName(part);
        const trackedResults = storage.searchFactionByName(part);
        
        let found = hofResults.find(f => f.name.toLowerCase() === part.toLowerCase());
        if (!found) {
            found = trackedResults.find(f => f.name.toLowerCase() === part.toLowerCase());
        }
        if (!found && hofResults.length > 0) {
            found = hofResults[0];
        }
        if (!found && trackedResults.length > 0) {
            found = trackedResults[0];
        }
        
        if (found && !seen.has(found.id)) {
            resolved.push({
                id: found.id,
                name: found.name,
                members: found.members || null
            });
            seen.add(found.id);
        }
    }
    
    return resolved;
}

module.exports = {
    DAY_NAMES,
    DAY_LABELS,
    parseDaysFilter,
    getHourFromTimestamp,
    get15MinSlotInHour,
    getDayOfWeek,
    formatTimeSlot,
    getThirtyDaysAgo,
    getDaysAgo,
    getWeekId,
    getUniqueWeeks,
    resolveMultipleFactions
};