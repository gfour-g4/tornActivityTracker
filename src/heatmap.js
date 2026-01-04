const { createCanvas } = require('@napi-rs/canvas');
const { 
    parseDaysFilter, 
    getHourFromTimestamp,
    get15MinSlotInHour,
    getDayOfWeek, 
    getThirtyDaysAgo,
    getWeekId,
    DAY_LABELS
} = require('./utils/helpers');
const storage = require('./utils/storage');
const db = require('./database');
const { heatmapCache, aggregateCache } = require('./utils/cache');
const config = require('./config');

// ============================================
// COLOR FUNCTIONS
// ============================================

function getColor(value, min, max) {
    if (max === min) return 'rgb(255, 255, 0)';
    
    const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
    
    let r, g, b;
    
    if (ratio < 0.5) {
        const t = ratio * 2;
        r = 255;
        g = Math.round(255 * t);
        b = 50;
    } else {
        const t = (ratio - 0.5) * 2;
        r = Math.round(255 * (1 - t));
        g = 255;
        b = 50;
    }
    
    return `rgb(${r}, ${g}, ${b})`;
}

function getTextColor(value, min, max) {
    const ratio = max > min ? (value - min) / (max - min) : 0.5;
    return ratio > 0.3 ? '#000000' : '#FFFFFF';
}

function formatLastUpdated(timestampMs) {
    if (!timestampMs) return 'Never';
    
    const now = Date.now();
    const diffMs = now - timestampMs;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    const date = new Date(timestampMs);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ============================================
// FAST AGGREGATION (using pre-computed data)
// ============================================

function aggregateFactionDataHourlyFast(factionId, dayFilter, dataTimestamp) {
    const cacheKey = `faction:hourly:${factionId}:${dayFilter}`;
    const cached = aggregateCache.get(cacheKey, dataTimestamp);
    if (cached) return cached;
    
    const daysToShow = parseDaysFilter(dayFilter);
    const aggregates = db.getHourlyAggregates(factionId, config.collection.dataRetentionDays);
    
    const result = {};
    const snapshotCounts = {};
    let globalMax = 0;
    
    for (let hour = 0; hour < 24; hour++) {
        result[hour] = {};
        snapshotCounts[hour] = {};
        for (const day of daysToShow) {
            result[hour][day] = 0;
            snapshotCounts[hour][day] = 0;
        }
    }
    
    for (const row of aggregates) {
        if (!daysToShow.includes(row.day_of_week)) continue;
        
        result[row.hour][row.day_of_week] = row.avg_active || 0;
        snapshotCounts[row.hour][row.day_of_week] = row.snapshot_count || 0;
        
        if (row.avg_active > globalMax) globalMax = row.avg_active;
    }
    
    const output = { 
        data: result, 
        min: 0, 
        max: globalMax, 
        days: daysToShow,
        snapshotCounts
    };
    
    aggregateCache.set(cacheKey, output);
    return output;
}

function aggregateFactionData15MinFast(factionId, dayFilter, dataTimestamp) {
    const cacheKey = `faction:15min:${factionId}:${dayFilter}`;
    const cached = aggregateCache.get(cacheKey, dataTimestamp);
    if (cached) return cached;
    
    const daysToShow = parseDaysFilter(dayFilter);
    const aggregates = db.get15MinAggregates(factionId, config.collection.dataRetentionDays);
    
    const result = {};
    let globalMax = 0;
    
    for (let hour = 0; hour < 24; hour++) {
        result[hour] = {};
        for (const day of daysToShow) {
            result[hour][day] = [0, 0, 0, 0];
        }
    }
    
    for (const row of aggregates) {
        if (!daysToShow.includes(row.day_of_week)) continue;
        
        const avg = row.avg_active || 0;
        result[row.hour][row.day_of_week][row.slot] = avg;
        
        if (avg > globalMax) globalMax = avg;
    }
    
    const output = { 
        data: result, 
        min: 0, 
        max: globalMax, 
        days: daysToShow,
        is15Min: true
    };
    
    aggregateCache.set(cacheKey, output);
    return output;
}
// ============================================
// USER AGGREGATION (needs raw snapshots)
// ============================================

function aggregateUserDataHourlyMultiFaction(userId, dayFilter, dataTimestamp) {
    const cacheKey = `user:hourly:${userId}:${dayFilter}`;
    const cached = aggregateCache.get(cacheKey, dataTimestamp);
    if (cached) return cached;
    
    const daysToShow = parseDaysFilter(dayFilter);
    const thirtyDaysAgo = getThirtyDaysAgo();
    const now = Math.floor(Date.now() / 1000);
    
    const factionIds = storage.findUserInAllFactions(userId);
    
    if (factionIds.length === 0) return null;
    
    const hourlyData = {};
    for (let hour = 0; hour < 24; hour++) {
        hourlyData[hour] = {};
        for (const day of daysToShow) {
            hourlyData[hour][day] = { weeksWithData: new Set(), weeksActive: new Set() };
        }
    }
    
    for (const factionId of factionIds) {
        const snapshots = db.getSnapshotsNormalized(factionId, thirtyDaysAgo);
        
        for (const snapshot of snapshots) {
            const day = getDayOfWeek(snapshot.timestamp);
            if (!daysToShow.includes(day)) continue;
            
            const hour = getHourFromTimestamp(snapshot.timestamp);
            const weekId = `${factionId}-${getWeekId(snapshot.timestamp, now)}`;
            
            hourlyData[hour][day].weeksWithData.add(weekId);
            if (snapshot.active.includes(userId)) {
                hourlyData[hour][day].weeksActive.add(weekId);
            }
        }
    }
    
    const result = {};
    
    for (let hour = 0; hour < 24; hour++) {
        result[hour] = {};
        for (const day of daysToShow) {
            const { weeksWithData, weeksActive } = hourlyData[hour][day];
            result[hour][day] = weeksWithData.size === 0 
                ? 0 
                : Math.round((weeksActive.size / weeksWithData.size) * 100);
        }
    }
    
    const output = { 
        data: result, 
        min: 0, 
        max: 100, 
        days: daysToShow,
        isPercentage: true,
        factionIds
    };
    
    aggregateCache.set(cacheKey, output);
    return output;
}

function aggregateUserData15MinMultiFaction(userId, dayFilter, dataTimestamp) {
    const cacheKey = `user:15min:${userId}:${dayFilter}`;
    const cached = aggregateCache.get(cacheKey, dataTimestamp);
    if (cached) return cached;
    
    const daysToShow = parseDaysFilter(dayFilter);
    const thirtyDaysAgo = getThirtyDaysAgo();
    
    const factionIds = storage.findUserInAllFactions(userId);
    
    if (factionIds.length === 0) return null;
    
    const data = {};
    for (let hour = 0; hour < 24; hour++) {
        data[hour] = {};
        for (const day of daysToShow) {
            data[hour][day] = [
                { total: 0, active: 0 },
                { total: 0, active: 0 },
                { total: 0, active: 0 },
                { total: 0, active: 0 }
            ];
        }
    }
    
    const processedSnapshots = new Set();
    
    for (const factionId of factionIds) {
        const snapshots = db.getSnapshotsNormalized(factionId, thirtyDaysAgo);
        
        for (const snapshot of snapshots) {
            const key = snapshot.timestamp.toString();
            if (processedSnapshots.has(key)) continue;
            processedSnapshots.add(key);
            
            const day = getDayOfWeek(snapshot.timestamp);
            if (!daysToShow.includes(day)) continue;
            
            const hour = getHourFromTimestamp(snapshot.timestamp);
            const slot = get15MinSlotInHour(snapshot.timestamp);
            
            data[hour][day][slot].total++;
            if (snapshot.active.includes(userId)) {
                data[hour][day][slot].active++;
            }
        }
    }
    
    const result = {};
    
    for (let hour = 0; hour < 24; hour++) {
        result[hour] = {};
        for (const day of daysToShow) {
            result[hour][day] = [];
            for (let slot = 0; slot < 4; slot++) {
                const { total, active } = data[hour][day][slot];
                result[hour][day].push(total === 0 ? 0 : Math.round((active / total) * 100));
            }
        }
    }
    
    const output = { 
        data: result, 
        min: 0, 
        max: 100, 
        days: daysToShow,
        is15Min: true,
        isPercentage: true,
        factionIds
    };
    
    aggregateCache.set(cacheKey, output);
    return output;
}

// ============================================
// IMAGE GENERATION
// ============================================

function generateHeatmapImage(title, aggregatedData, subtitle = '', lastUpdated = null) {
    const { data, min, max, days, isPercentage } = aggregatedData;
    
    const cellWidth = 55;
    const cellHeight = 28;
    const labelWidth = 60;
    const headerHeight = 50;
    const titleHeight = subtitle ? 65 : 45;
    const legendHeight = 40;
    const footerHeight = lastUpdated ? 25 : 0;
    const padding = 20;
    
    const width = labelWidth + (days.length * cellWidth) + padding * 2;
    const height = titleHeight + headerHeight + (24 * cellHeight) + legendHeight + footerHeight + padding * 2;
    
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#2C2F33';
    ctx.fillRect(0, 0, width, height);
    
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(title, width / 2, padding + 25);
    
    if (subtitle) {
        ctx.font = '12px Arial';
        ctx.fillStyle = '#AAAAAA';
        ctx.fillText(subtitle, width / 2, padding + 45);
    }
    
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    
    days.forEach((day, i) => {
        const x = padding + labelWidth + (i * cellWidth) + cellWidth / 2;
        const y = padding + titleHeight + 30;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(DAY_LABELS[day], x, y);
    });
    
    ctx.font = '12px Arial';
    
    for (let hour = 0; hour < 24; hour++) {
        const y = padding + titleHeight + headerHeight + (hour * cellHeight);
        
        ctx.fillStyle = '#AAAAAA';
        ctx.textAlign = 'right';
        ctx.fillText(`${hour.toString().padStart(2, '0')}:00`, padding + labelWidth - 8, y + cellHeight / 2 + 4);
        
        days.forEach((day, i) => {
            const x = padding + labelWidth + (i * cellWidth);
            const value = data[hour][day];
            
            ctx.fillStyle = getColor(value, min, max);
            ctx.fillRect(x + 2, y + 2, cellWidth - 4, cellHeight - 4);
            
            ctx.strokeStyle = '#1E2124';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 2, y + 2, cellWidth - 4, cellHeight - 4);
            
            ctx.fillStyle = getTextColor(value, min, max);
            ctx.textAlign = 'center';
            ctx.font = '12px Arial';
            
            const displayValue = isPercentage 
                ? `${Math.round(value)}%` 
                : (Number.isInteger(value) ? value.toString() : value.toFixed(1));
            ctx.fillText(displayValue, x + cellWidth / 2, y + cellHeight / 2 + 4);
        });
    }
    
    const legendY = padding + titleHeight + headerHeight + (24 * cellHeight) + 10;
    const legendWidth = 200;
    const legendX = (width - legendWidth) / 2;
    
    const gradient = ctx.createLinearGradient(legendX, 0, legendX + legendWidth, 0);
    gradient.addColorStop(0, 'rgb(255, 50, 50)');
    gradient.addColorStop(0.5, 'rgb(255, 255, 50)');
    gradient.addColorStop(1, 'rgb(50, 255, 50)');
    
    ctx.fillStyle = gradient;
    ctx.fillRect(legendX, legendY, legendWidth, 15);
    
    ctx.strokeStyle = '#1E2124';
    ctx.strokeRect(legendX, legendY, legendWidth, 15);
    
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '11px Arial';
    ctx.textAlign = 'center';
    
    const minLabel = isPercentage ? `${min}%` : min.toString();
    const maxLabel = isPercentage ? `${max}%` : max.toString();
    ctx.fillText(minLabel, legendX, legendY + 28);
    ctx.fillText(maxLabel, legendX + legendWidth, legendY + 28);
    
    // Last updated footer
    if (lastUpdated) {
        ctx.fillStyle = '#666666';
        ctx.font = '10px Arial';
        ctx.textAlign = 'right';
        ctx.fillText(`Updated: ${formatLastUpdated(lastUpdated)}`, width - padding, height - padding + 5);
    }
    
    return canvas.toBuffer('image/png');
}

function generateCompact15MinImage(title, aggregatedData, subtitle = '', lastUpdated = null) {
    const { data, min, max, days, isPercentage } = aggregatedData;
    
    const cellWidth = 75;
    const cellHeight = 24;
    const labelWidth = 60;
    const headerHeight = 50;
    const titleHeight = subtitle ? 65 : 45;
    const legendHeight = 50;
    const footerHeight = lastUpdated ? 25 : 0;
    const padding = 20;
    
    const width = labelWidth + (days.length * cellWidth) + padding * 2;
    const height = titleHeight + headerHeight + (24 * cellHeight) + legendHeight + footerHeight + padding * 2;
    
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#2C2F33';
    ctx.fillRect(0, 0, width, height);
    
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(title, width / 2, padding + 25);
    
    if (subtitle) {
        ctx.font = '12px Arial';
        ctx.fillStyle = '#AAAAAA';
        ctx.fillText(subtitle, width / 2, padding + 45);
    }
    
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    
    days.forEach((day, i) => {
        const x = padding + labelWidth + (i * cellWidth) + cellWidth / 2;
        const y = padding + titleHeight + 30;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(DAY_LABELS[day], x, y);
    });
    
    for (let hour = 0; hour < 24; hour++) {
        const y = padding + titleHeight + headerHeight + (hour * cellHeight);
        
        ctx.fillStyle = '#AAAAAA';
        ctx.textAlign = 'right';
        ctx.font = '11px Arial';
        ctx.fillText(`${hour.toString().padStart(2, '0')}:00`, padding + labelWidth - 8, y + cellHeight / 2 + 4);
        
        days.forEach((day, i) => {
            const x = padding + labelWidth + (i * cellWidth);
            const values = data[hour][day];
            
            const subWidth = (cellWidth - 4) / 4;
            
            for (let slot = 0; slot < 4; slot++) {
                const subX = x + 2 + (slot * subWidth);
                const val = values[slot];
                
                ctx.fillStyle = getColor(val, min, max);
                ctx.fillRect(subX + 1, y + 3, subWidth - 2, cellHeight - 6);
                
                ctx.fillStyle = getTextColor(val, min, max);
                ctx.textAlign = 'center';
                ctx.font = '9px Arial';
                
                const displayVal = isPercentage ? Math.round(val).toString() : Math.round(val).toString();
                ctx.fillText(displayVal, subX + subWidth / 2, y + cellHeight / 2 + 3);
            }
        });
    }
    
    const legendY = padding + titleHeight + headerHeight + (24 * cellHeight) + 10;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '11px Arial';
    ctx.textAlign = 'center';
    
    const legendText = isPercentage 
        ? 'Each cell: :00 | :15 | :30 | :45 (% active)'
        : 'Each cell: :00 | :15 | :30 | :45 (avg members)';
    ctx.fillText(legendText, width / 2, legendY);
    
    const gradWidth = 150;
    const gradX = (width - gradWidth) / 2;
    
    const gradient = ctx.createLinearGradient(gradX, 0, gradX + gradWidth, 0);
    gradient.addColorStop(0, 'rgb(255, 50, 50)');
    gradient.addColorStop(0.5, 'rgb(255, 255, 50)');
    gradient.addColorStop(1, 'rgb(50, 255, 50)');
    
    ctx.fillStyle = gradient;
    ctx.fillRect(gradX, legendY + 10, gradWidth, 12);
    
    ctx.strokeStyle = '#1E2124';
    ctx.strokeRect(gradX, legendY + 10, gradWidth, 12);
    
    const minLabel = isPercentage ? '0%' : min.toString();
    const maxLabel = isPercentage ? '100%' : max.toString();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(minLabel, gradX, legendY + 35);
    ctx.fillText(maxLabel, gradX + gradWidth, legendY + 35);
    
    // Last updated footer
    if (lastUpdated) {
        ctx.fillStyle = '#666666';
        ctx.font = '10px Arial';
        ctx.textAlign = 'right';
        ctx.fillText(`Updated: ${formatLastUpdated(lastUpdated)}`, width - padding, height - padding + 5);
    }
    
    return canvas.toBuffer('image/png');
}

function generateComparisonImage(title1, data1, title2, data2, lastUpdated1 = null, lastUpdated2 = null) {
    const days = data1.days;
    const is15Min = data1.is15Min;
    
    const cellWidth = is15Min ? 65 : 45;
    const cellHeight = 22;
    const labelWidth = 45;
    const headerHeight = 45;
    const titleHeight = 35;
    const gapWidth = 25;
    const footerHeight = 25;
    const padding = 15;
    const sectionWidth = labelWidth + (days.length * cellWidth);
    
    const width = (sectionWidth * 2) + gapWidth + padding * 2;
    const height = titleHeight + headerHeight + (24 * cellHeight) + padding * 2 + 30 + footerHeight;
    
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#2C2F33';
    ctx.fillRect(0, 0, width, height);
    
    const globalMin = Math.min(data1.min, data2.min);
    const globalMax = Math.max(data1.max, data2.max);
    
    function drawSection(data, title, offsetX, lastUpdated) {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 13px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(title, offsetX + sectionWidth / 2, padding + 20);
        
        // Show last updated under title
        if (lastUpdated) {
            ctx.fillStyle = '#666666';
            ctx.font = '9px Arial';
            ctx.fillText(`(${formatLastUpdated(lastUpdated)})`, offsetX + sectionWidth / 2, padding + 32);
        }
        
        ctx.font = 'bold 10px Arial';
        ctx.fillStyle = '#FFFFFF';
        days.forEach((day, i) => {
            const x = offsetX + labelWidth + (i * cellWidth) + cellWidth / 2;
            ctx.fillText(DAY_LABELS[day], x, padding + titleHeight + 22);
        });
        
        for (let hour = 0; hour < 24; hour++) {
            const y = padding + titleHeight + headerHeight + (hour * cellHeight);
            
            if (offsetX === padding) {
                ctx.fillStyle = '#AAAAAA';
                ctx.textAlign = 'right';
                ctx.font = '9px Arial';
                ctx.fillText(`${hour.toString().padStart(2, '0')}:00`, offsetX + labelWidth - 4, y + cellHeight / 2 + 3);
            }
            
            days.forEach((day, i) => {
                const x = offsetX + labelWidth + (i * cellWidth);
                
                if (is15Min) {
                    const values = data.data[hour][day];
                    const subWidth = (cellWidth - 2) / 4;
                    
                    for (let slot = 0; slot < 4; slot++) {
                        const subX = x + 1 + (slot * subWidth);
                        const val = values[slot];
                        
                        ctx.fillStyle = getColor(val, globalMin, globalMax);
                        ctx.fillRect(subX, y + 1, subWidth - 1, cellHeight - 2);
                        
                        ctx.fillStyle = getTextColor(val, globalMin, globalMax);
                        ctx.textAlign = 'center';
                        ctx.font = '7px Arial';
                        ctx.fillText(Math.round(val).toString(), subX + subWidth / 2, y + cellHeight / 2 + 2);
                    }
                } else {
                    const value = data.data[hour][day];
                    
                    ctx.fillStyle = getColor(value, globalMin, globalMax);
                    ctx.fillRect(x + 1, y + 1, cellWidth - 2, cellHeight - 2);
                    
                    ctx.strokeStyle = '#1E2124';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(x + 1, y + 1, cellWidth - 2, cellHeight - 2);
                    
                    ctx.fillStyle = getTextColor(value, globalMin, globalMax);
                    ctx.textAlign = 'center';
                    ctx.font = '9px Arial';
                    const displayValue = Number.isInteger(value) ? value.toString() : value.toFixed(1);
                    ctx.fillText(displayValue, x + cellWidth / 2, y + cellHeight / 2 + 3);
                }
            });
        }
    }
    
    drawSection(data1, title1, padding, lastUpdated1);
    drawSection(data2, title2, padding + sectionWidth + gapWidth, lastUpdated2);
    
    return canvas.toBuffer('image/png');
}

function generateDifferenceImage(title1, data1, title2, data2, lastUpdated = null) {
    const days = data1.days;
    const is15Min = data1.is15Min;
    
    const cellWidth = is15Min ? 75 : 55;
    const cellHeight = is15Min ? 24 : 28;
    const labelWidth = 60;
    const headerHeight = 50;
    const titleHeight = 45;
    const legendHeight = 50;
    const footerHeight = lastUpdated ? 25 : 0;
    const padding = 20;
    
    const width = labelWidth + (days.length * cellWidth) + padding * 2;
    const height = titleHeight + headerHeight + (24 * cellHeight) + legendHeight + footerHeight + padding * 2;
    
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#2C2F33';
    ctx.fillRect(0, 0, width, height);
    
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`Difference: ${title1} vs ${title2}`, width / 2, padding + 25);
    
    ctx.font = 'bold 14px Arial';
    days.forEach((day, i) => {
        const x = padding + labelWidth + (i * cellWidth) + cellWidth / 2;
        ctx.fillText(DAY_LABELS[day], x, padding + titleHeight + 30);
    });
    
    let diffMin = Infinity;
    let diffMax = -Infinity;
    
    const diffData = {};
    for (let hour = 0; hour < 24; hour++) {
        diffData[hour] = {};
        for (const day of days) {
            if (is15Min) {
                diffData[hour][day] = [];
                for (let slot = 0; slot < 4; slot++) {
                    const diff = data1.data[hour][day][slot] - data2.data[hour][day][slot];
                    diffData[hour][day].push(diff);
                    if (diff < diffMin) diffMin = diff;
                    if (diff > diffMax) diffMax = diff;
                }
            } else {
                const diff = data1.data[hour][day] - data2.data[hour][day];
                diffData[hour][day] = diff;
                if (diff < diffMin) diffMin = diff;
                if (diff > diffMax) diffMax = diff;
            }
        }
    }
    
    function getDiffColor(value) {
        const absMax = Math.max(Math.abs(diffMin), Math.abs(diffMax), 1);
        const ratio = value / absMax;
        
        if (ratio < 0) {
            const t = Math.min(1, Math.abs(ratio));
            return `rgb(255, ${Math.round(255 * (1 - t))}, ${Math.round(255 * (1 - t))})`;
        } else {
            const t = Math.min(1, ratio);
            return `rgb(${Math.round(255 * (1 - t))}, 255, ${Math.round(255 * (1 - t))})`;
        }
    }
    
    for (let hour = 0; hour < 24; hour++) {
        const y = padding + titleHeight + headerHeight + (hour * cellHeight);
        
        ctx.fillStyle = '#AAAAAA';
        ctx.textAlign = 'right';
        ctx.font = '11px Arial';
        ctx.fillText(`${hour.toString().padStart(2, '0')}:00`, padding + labelWidth - 8, y + cellHeight / 2 + 4);
        
        days.forEach((day, i) => {
            const x = padding + labelWidth + (i * cellWidth);
            
            if (is15Min) {
                const values = diffData[hour][day];
                const subWidth = (cellWidth - 4) / 4;
                
                for (let slot = 0; slot < 4; slot++) {
                    const subX = x + 2 + (slot * subWidth);
                    const val = values[slot];
                    
                    ctx.fillStyle = getDiffColor(val);
                    ctx.fillRect(subX + 1, y + 3, subWidth - 2, cellHeight - 6);
                    
                    ctx.fillStyle = '#000000';
                    ctx.textAlign = 'center';
                    ctx.font = '8px Arial';
                    const sign = val > 0 ? '+' : '';
                    ctx.fillText(`${sign}${Math.round(val)}`, subX + subWidth / 2, y + cellHeight / 2 + 3);
                }
            } else {
                const value = diffData[hour][day];
                
                ctx.fillStyle = getDiffColor(value);
                ctx.fillRect(x + 2, y + 2, cellWidth - 4, cellHeight - 4);
                
                ctx.strokeStyle = '#1E2124';
                ctx.strokeRect(x + 2, y + 2, cellWidth - 4, cellHeight - 4);
                
                ctx.fillStyle = '#000000';
                ctx.textAlign = 'center';
                ctx.font = '11px Arial';
                const sign = value > 0 ? '+' : '';
                ctx.fillText(`${sign}${value.toFixed(1)}`, x + cellWidth / 2, y + cellHeight / 2 + 4);
            }
        });
    }
    
    const legendY = padding + titleHeight + headerHeight + (24 * cellHeight) + 15;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`Green = ${title1} higher | Red = ${title2} higher`, width / 2, legendY + 15);
    
    // Last updated footer
    if (lastUpdated) {
        ctx.fillStyle = '#666666';
        ctx.font = '10px Arial';
        ctx.textAlign = 'right';
        ctx.fillText(`Updated: ${formatLastUpdated(lastUpdated)}`, width - padding, height - padding + 5);
    }
    
    return canvas.toBuffer('image/png');
}


function generateLeaderboardImage(factionName, factionId, leaderboard, period, totalSnapshots, lastUpdated = null) {
    const rowHeight = 44;
    const headerHeight = 80;
    const footerHeight = 50;
    const padding = 24;
    const width = 500;
    const height = headerHeight + (leaderboard.length * rowHeight) + footerHeight + padding * 2;
    
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);
    
    // Header background
    const headerGradient = ctx.createLinearGradient(0, 0, width, 0);
    headerGradient.addColorStop(0, '#16213e');
    headerGradient.addColorStop(1, '#1a1a2e');
    ctx.fillStyle = headerGradient;
    ctx.fillRect(0, 0, width, headerHeight + padding);
    
    // Title
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 22px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(factionName, padding + 30, padding + 28);
    
    // Trophy icon (drawn)
    drawTrophy(ctx, padding + 6, padding + 10, 20, '#FFD700');
    
    // Subtitle
    ctx.fillStyle = '#8892b0';
    ctx.font = '14px Arial';
    ctx.fillText(`Activity Leaderboard • Last ${period} days`, padding, padding + 52);
    
    // Data points badge
    ctx.fillStyle = '#233554';
    const badgeText = `${totalSnapshots} snapshots`;
    const badgeWidth = ctx.measureText(badgeText).width + 20;
    const badgeX = width - padding - badgeWidth;
    roundRect(ctx, badgeX, padding + 15, badgeWidth, 28, 14);
    ctx.fill();
    
    ctx.fillStyle = '#64ffda';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(badgeText, badgeX + badgeWidth / 2, padding + 34);
    
    // Leaderboard rows
    const startY = headerHeight + padding + 10;
    
    const medalColors = [
        { bg: '#FFD700', text: '#000000' }, // Gold
        { bg: '#C0C0C0', text: '#000000' }, // Silver
        { bg: '#CD7F32', text: '#FFFFFF' }  // Bronze
    ];
    
    for (let i = 0; i < leaderboard.length; i++) {
        const member = leaderboard[i];
        const y = startY + (i * rowHeight);
        const percentage = totalSnapshots > 0 
            ? Math.round((member.times_active / totalSnapshots) * 100) 
            : 0;
        
        // Row background (alternating)
        if (i % 2 === 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
            ctx.fillRect(padding - 8, y - 8, width - padding * 2 + 16, rowHeight);
        }
        
        // Rank badge
        const rankX = padding + 12;
        const rankY = y + 12;
        
        if (i < 3) {
            // Medal circle for top 3
            ctx.beginPath();
            ctx.arc(rankX, rankY, 12, 0, Math.PI * 2);
            ctx.fillStyle = medalColors[i].bg;
            ctx.fill();
            
            // Rank number inside medal
            ctx.fillStyle = medalColors[i].text;
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${i + 1}`, rankX, rankY);
        } else {
            // Simple circle for others
            ctx.beginPath();
            ctx.arc(rankX, rankY, 12, 0, Math.PI * 2);
            ctx.fillStyle = '#233554';
            ctx.fill();
            
            ctx.fillStyle = '#8892b0';
            ctx.font = 'bold 11px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${i + 1}`, rankX, rankY);
        }
        
        // Reset text baseline
        ctx.textBaseline = 'alphabetic';
        
        // Name
        const name = member.name || `User ${member.member_id}`;
        ctx.fillStyle = i < 3 ? '#FFFFFF' : '#cbd5e0';
        ctx.font = i < 3 ? 'bold 15px Arial' : '14px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(truncateText(ctx, name, 180), padding + 36, y + 17);
        
        // Progress bar background
        const barX = 240;
        const barWidth = 150;
        const barHeight = 16;
        const barY = y + 4;
        
        ctx.fillStyle = '#233554';
        roundRect(ctx, barX, barY, barWidth, barHeight, 8);
        ctx.fill();
        
        // Progress bar fill
        const fillWidth = Math.max(2, (percentage / 100) * barWidth);
        const barGradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
        
        if (percentage >= 70) {
            barGradient.addColorStop(0, '#10b981');
            barGradient.addColorStop(1, '#34d399');
        } else if (percentage >= 40) {
            barGradient.addColorStop(0, '#f59e0b');
            barGradient.addColorStop(1, '#fbbf24');
        } else {
            barGradient.addColorStop(0, '#ef4444');
            barGradient.addColorStop(1, '#f87171');
        }
        
        ctx.fillStyle = barGradient;
        roundRect(ctx, barX, barY, fillWidth, barHeight, 8);
        ctx.fill();
        
        // Percentage text
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'right';
        ctx.fillText(`${percentage}%`, width - padding, y + 17);
    }
    
    // Footer
    const footerY = height - footerHeight;
    
    ctx.fillStyle = '#4a5568';
    ctx.font = '11px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`Faction ID: ${factionId}`, padding, footerY + 25);
    
    if (lastUpdated) {
        ctx.textAlign = 'right';
        ctx.fillText(`Updated: ${formatLastUpdated(lastUpdated)}`, width - padding, footerY + 25);
    }
    
    return canvas.toBuffer('image/png');
}

// Helper: Draw a simple trophy shape
function drawTrophy(ctx, x, y, size, color) {
    ctx.fillStyle = color;
    
    // Cup body
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x + size * 0.85, y + size * 0.6);
    ctx.lineTo(x + size * 0.15, y + size * 0.6);
    ctx.closePath();
    ctx.fill();
    
    // Stem
    ctx.fillRect(x + size * 0.35, y + size * 0.6, size * 0.3, size * 0.25);
    
    // Base
    ctx.fillRect(x + size * 0.2, y + size * 0.85, size * 0.6, size * 0.15);
    
    // Handles
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    
    // Left handle
    ctx.beginPath();
    ctx.arc(x - 2, y + size * 0.25, size * 0.15, -Math.PI * 0.5, Math.PI * 0.5);
    ctx.stroke();
    
    // Right handle
    ctx.beginPath();
    ctx.arc(x + size + 2, y + size * 0.25, size * 0.15, Math.PI * 0.5, -Math.PI * 0.5);
    ctx.stroke();
}

// Helper function for rounded rectangles
function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

// Helper function to truncate text
function truncateText(ctx, text, maxWidth) {
    let truncated = text;
    while (ctx.measureText(truncated).width > maxWidth && truncated.length > 0) {
        truncated = truncated.slice(0, -1);
    }
    if (truncated !== text) {
        truncated = truncated.slice(0, -2) + '…';
    }
    return truncated;
}

// Helper function for rounded rectangles
function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

// Helper function to truncate text
function truncateText(ctx, text, maxWidth) {
    let truncated = text;
    while (ctx.measureText(truncated).width > maxWidth && truncated.length > 0) {
        truncated = truncated.slice(0, -1);
    }
    if (truncated !== text) {
        truncated = truncated.slice(0, -2) + '…';
    }
    return truncated;
}




// ============================================
// PUBLIC API (with cache invalidation)
// ============================================

async function createFactionHeatmap(factionId, granularity, dayFilter) {
    const lastUpdated = db.getFactionLastUpdated(factionId);
    
    const cacheKey = `img:faction:${factionId}:${granularity}:${dayFilter}`;
    const cached = heatmapCache.get(cacheKey, lastUpdated);
    if (cached) return cached;
    
    const faction = db.getFaction(factionId);
    
    if (!faction) {
        throw new Error(`No data available for faction ${factionId}. Wait for data collection.`);
    }
    
    const title = `${faction.name || 'Faction'} [${factionId}]`;
    const numWeeks = db.getWeekCount(factionId);
    const subtitle = `Last ${config.collection.dataRetentionDays} days (${numWeeks} week${numWeeks !== 1 ? 's' : ''} of data) - Avg active per hour`;
    
    let buffer;
    if (granularity === '15min') {
        const aggregated = aggregateFactionData15MinFast(factionId, dayFilter, lastUpdated);
        buffer = generateCompact15MinImage(title, aggregated, subtitle, lastUpdated);
    } else {
        const aggregated = aggregateFactionDataHourlyFast(factionId, dayFilter, lastUpdated);
        buffer = generateHeatmapImage(title, aggregated, subtitle, lastUpdated);
    }
    
    heatmapCache.set(cacheKey, buffer);
    return buffer;
}

async function createUserHeatmap(userId, granularity, dayFilter) {
    const lastUpdated = db.getUserLastUpdated(userId);
    
    const cacheKey = `img:user:${userId}:${granularity}:${dayFilter}`;
    const cached = heatmapCache.get(cacheKey, lastUpdated);
    if (cached) return cached;
    
    let aggregated;
    
    if (granularity === '15min') {
        aggregated = aggregateUserData15MinMultiFaction(userId, dayFilter, lastUpdated);
    } else {
        aggregated = aggregateUserDataHourlyMultiFaction(userId, dayFilter, lastUpdated);
    }
    
    if (!aggregated) {
        throw new Error(`User ${userId} not found in any tracked faction.`);
    }
    
    const userName = storage.getMemberName(userId) || 'User';
    const title = `${userName} [${userId}]`;
    
    const numWeeks = aggregated.factionIds.length > 0 ? db.getWeekCount(aggregated.factionIds[0]) : 0;
    
    const factionInfo = aggregated.factionIds.length > 1 
        ? `across ${aggregated.factionIds.length} factions` 
        : '';
    const subtitle = `Last ${config.collection.dataRetentionDays} days (${numWeeks} week${numWeeks !== 1 ? 's' : ''}) - % active ${factionInfo}`;
    
    let buffer;
    if (granularity === '15min') {
        buffer = generateCompact15MinImage(title, aggregated, subtitle, lastUpdated);
    } else {
        buffer = generateHeatmapImage(title, aggregated, subtitle, lastUpdated);
    }
    
    heatmapCache.set(cacheKey, buffer);
    return buffer;
}

async function createComparisonHeatmaps(faction1Id, faction2Id, granularity, dayFilter) {
    const lastUpdated1 = db.getFactionLastUpdated(faction1Id);
    const lastUpdated2 = db.getFactionLastUpdated(faction2Id);
    const latestUpdate = Math.max(lastUpdated1, lastUpdated2);
    
    const cacheKey = `img:compare:${faction1Id}:${faction2Id}:${granularity}:${dayFilter}`;
    const cached = heatmapCache.get(cacheKey, latestUpdate);
    if (cached) return cached;
    
    const faction1 = db.getFaction(faction1Id);
    const faction2 = db.getFaction(faction2Id);
    
    if (!faction1) throw new Error(`No data available for faction ${faction1Id}.`);
    if (!faction2) throw new Error(`No data available for faction ${faction2Id}.`);
    
    const name1 = faction1.name || `Faction ${faction1Id}`;
    const name2 = faction2.name || `Faction ${faction2Id}`;
    
    let agg1, agg2;
    
    if (granularity === '15min') {
        agg1 = aggregateFactionData15MinFast(faction1Id, dayFilter, lastUpdated1);
        agg2 = aggregateFactionData15MinFast(faction2Id, dayFilter, lastUpdated2);
    } else {
        agg1 = aggregateFactionDataHourlyFast(faction1Id, dayFilter, lastUpdated1);
        agg2 = aggregateFactionDataHourlyFast(faction2Id, dayFilter, lastUpdated2);
    }
    
    const sideBySide = generateComparisonImage(name1, agg1, name2, agg2, lastUpdated1, lastUpdated2);
    const difference = generateDifferenceImage(name1, agg1, name2, agg2, latestUpdate);
    
    const result = { sideBySide, difference };
    heatmapCache.set(cacheKey, result);
    
    return result;
}

module.exports = {
    createFactionHeatmap,
    createUserHeatmap,
    createComparisonHeatmaps,
    createFactionHeatmap,
    createUserHeatmap,
    createComparisonHeatmaps,
    generateLeaderboardImage
};