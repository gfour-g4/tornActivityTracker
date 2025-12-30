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
    return Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
}

function getWeekId(timestamp, referenceTimestamp) {
    const refDate = new Date(referenceTimestamp * 1000);
    const targetDate = new Date(timestamp * 1000);
    
    // Get start of week (Sunday) for reference
    const refWeekStart = new Date(refDate);
    refWeekStart.setUTCHours(0, 0, 0, 0);
    refWeekStart.setUTCDate(refWeekStart.getUTCDate() - refWeekStart.getUTCDay());
    
    // Get start of week for target
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

module.exports = {
    DAY_NAMES,
    DAY_LABELS,
    parseDaysFilter,
    getHourFromTimestamp,
    get15MinSlotInHour,
    getDayOfWeek,
    formatTimeSlot,
    getThirtyDaysAgo,
    getWeekId,
    getUniqueWeeks
};