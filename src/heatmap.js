const { createCanvas } = require('canvas');
const { 
    parseDaysFilter, 
    getHourFromTimestamp,
    get15MinSlotInHour,
    getDayOfWeek, 
    getThirtyDaysAgo,
    getWeekId,
    getUniqueWeeks,
    DAY_LABELS
} = require('./utils/helpers');
const storage = require('./utils/storage');

// Color interpolation: Red -> Yellow -> Green
function getColor(value, min, max) {
    if (max === min) {
        return 'rgb(255, 255, 0)';
    }
    
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

// ============================================
// FACTION AGGREGATION
// ============================================

function aggregateFactionDataHourly(factionData, dayFilter) {
    const daysToShow = parseDaysFilter(dayFilter);
    const thirtyDaysAgo = getThirtyDaysAgo();
    const now = Math.floor(Date.now() / 1000);
    const snapshots = storage.getSnapshotsNormalized(factionData);
    
    // Structure: [hour][day][weekId] = Set of member IDs
    const hourlyData = {};
    for (let hour = 0; hour < 24; hour++) {
        hourlyData[hour] = {};
        for (const day of daysToShow) {
            hourlyData[hour][day] = {};
        }
    }
    
    for (const snapshot of snapshots) {
        if (snapshot.timestamp < thirtyDaysAgo) continue;
        
        const day = getDayOfWeek(snapshot.timestamp);
        if (!daysToShow.includes(day)) continue;
        
        const hour = getHourFromTimestamp(snapshot.timestamp);
        const weekId = getWeekId(snapshot.timestamp, now);
        
        if (!hourlyData[hour][day][weekId]) {
            hourlyData[hour][day][weekId] = new Set();
        }
        
        for (const memberId of snapshot.active) {
            hourlyData[hour][day][weekId].add(memberId);
        }
    }
    
    const result = {};
    let globalMin = Infinity;
    let globalMax = -Infinity;
    
    for (let hour = 0; hour < 24; hour++) {
        result[hour] = {};
        for (const day of daysToShow) {
            const weekData = hourlyData[hour][day];
            const weekIds = Object.keys(weekData);
            
            if (weekIds.length === 0) {
                result[hour][day] = 0;
            } else {
                let total = 0;
                for (const weekId of weekIds) {
                    total += weekData[weekId].size;
                }
                result[hour][day] = Math.round(total / weekIds.length * 10) / 10;
            }
            
            if (result[hour][day] < globalMin) globalMin = result[hour][day];
            if (result[hour][day] > globalMax) globalMax = result[hour][day];
        }
    }
    
    return { 
        data: result, 
        min: globalMin === Infinity ? 0 : globalMin, 
        max: globalMax === -Infinity ? 0 : globalMax, 
        days: daysToShow 
    };
}

function aggregateFactionData15Min(factionData, dayFilter) {
    const daysToShow = parseDaysFilter(dayFilter);
    const thirtyDaysAgo = getThirtyDaysAgo();
    const now = Math.floor(Date.now() / 1000);
    const snapshots = storage.getSnapshotsNormalized(factionData);
    
    // Structure: [hour][day][slot][weekId] = Set of member IDs
    const data = {};
    for (let hour = 0; hour < 24; hour++) {
        data[hour] = {};
        for (const day of daysToShow) {
            data[hour][day] = {
                0: {}, 1: {}, 2: {}, 3: {}
            };
        }
    }
    
    for (const snapshot of snapshots) {
        if (snapshot.timestamp < thirtyDaysAgo) continue;
        
        const day = getDayOfWeek(snapshot.timestamp);
        if (!daysToShow.includes(day)) continue;
        
        const hour = getHourFromTimestamp(snapshot.timestamp);
        const slot = get15MinSlotInHour(snapshot.timestamp);
        const weekId = getWeekId(snapshot.timestamp, now);
        
        if (!data[hour][day][slot][weekId]) {
            data[hour][day][slot][weekId] = new Set();
        }
        
        for (const memberId of snapshot.active) {
            data[hour][day][slot][weekId].add(memberId);
        }
    }
    
    const result = {};
    let globalMin = Infinity;
    let globalMax = -Infinity;
    
    for (let hour = 0; hour < 24; hour++) {
        result[hour] = {};
        for (const day of daysToShow) {
            result[hour][day] = [];
            
            for (let slot = 0; slot < 4; slot++) {
                const weekData = data[hour][day][slot];
                const weekIds = Object.keys(weekData);
                
                let avg = 0;
                if (weekIds.length > 0) {
                    let total = 0;
                    for (const weekId of weekIds) {
                        total += weekData[weekId].size;
                    }
                    avg = Math.round(total / weekIds.length * 10) / 10;
                }
                
                result[hour][day].push(avg);
                
                if (avg < globalMin) globalMin = avg;
                if (avg > globalMax) globalMax = avg;
            }
        }
    }
    
    return { 
        data: result, 
        min: globalMin === Infinity ? 0 : globalMin, 
        max: globalMax === -Infinity ? 0 : globalMax, 
        days: daysToShow,
        is15Min: true
    };
}

// ============================================
// USER AGGREGATION (MULTI-FACTION)
// ============================================

function aggregateUserDataHourlyMultiFaction(userId, dayFilter) {
    const daysToShow = parseDaysFilter(dayFilter);
    const thirtyDaysAgo = getThirtyDaysAgo();
    const now = Math.floor(Date.now() / 1000);
    
    // Find all factions user has been in
    const factionIds = storage.findUserInAllFactions(userId);
    
    if (factionIds.length === 0) {
        return null;
    }
    
    // Aggregate across all factions
    const hourlyData = {};
    for (let hour = 0; hour < 24; hour++) {
        hourlyData[hour] = {};
        for (const day of daysToShow) {
            hourlyData[hour][day] = {
                weeksWithData: new Set(),
                weeksActive: new Set()
            };
        }
    }
    
    for (const factionId of factionIds) {
        const factionData = storage.loadFactionData(factionId);
        const snapshots = storage.getSnapshotsNormalized(factionData);
        
        for (const snapshot of snapshots) {
            if (snapshot.timestamp < thirtyDaysAgo) continue;
            
            const day = getDayOfWeek(snapshot.timestamp);
            if (!daysToShow.includes(day)) continue;
            
            const hour = getHourFromTimestamp(snapshot.timestamp);
            const weekId = getWeekId(snapshot.timestamp, now);
            
            // Create unique week key to avoid double counting
            const weekKey = `${factionId}-${weekId}`;
            hourlyData[hour][day].weeksWithData.add(weekKey);
            
            if (snapshot.active.includes(userId)) {
                hourlyData[hour][day].weeksActive.add(weekKey);
            }
        }
    }
    
    const result = {};
    
    for (let hour = 0; hour < 24; hour++) {
        result[hour] = {};
        for (const day of daysToShow) {
            const { weeksWithData, weeksActive } = hourlyData[hour][day];
            
            if (weeksWithData.size === 0) {
                result[hour][day] = 0;
            } else {
                result[hour][day] = Math.round((weeksActive.size / weeksWithData.size) * 100);
            }
        }
    }
    
    return { 
        data: result, 
        min: 0, 
        max: 100, 
        days: daysToShow,
        isPercentage: true,
        factionIds
    };
}

function aggregateUserData15MinMultiFaction(userId, dayFilter) {
    const daysToShow = parseDaysFilter(dayFilter);
    const thirtyDaysAgo = getThirtyDaysAgo();
    
    const factionIds = storage.findUserInAllFactions(userId);
    
    if (factionIds.length === 0) {
        return null;
    }
    
    // Structure: [hour][day][slot] = { total: 0, active: 0 }
    const data = {};
    for (let hour = 0; hour < 24; hour++) {
        data[hour] = {};
        for (const day of daysToShow) {
            data[hour][day] = {
                0: { total: 0, active: 0 },
                1: { total: 0, active: 0 },
                2: { total: 0, active: 0 },
                3: { total: 0, active: 0 }
            };
        }
    }
    
    // Track processed snapshots to avoid double counting
    const processedSnapshots = new Set();
    
    for (const factionId of factionIds) {
        const factionData = storage.loadFactionData(factionId);
        const snapshots = storage.getSnapshotsNormalized(factionData);
        
        for (const snapshot of snapshots) {
            if (snapshot.timestamp < thirtyDaysAgo) continue;
            
            // Unique key for this snapshot
            const snapshotKey = `${snapshot.timestamp}`;
            if (processedSnapshots.has(snapshotKey)) continue;
            processedSnapshots.add(snapshotKey);
            
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
                
                if (total === 0) {
                    result[hour][day].push(0);
                } else {
                    result[hour][day].push(Math.round((active / total) * 100));
                }
            }
        }
    }
    
    return { 
        data: result, 
        min: 0, 
        max: 100, 
        days: daysToShow,
        is15Min: true,
        isPercentage: true,
        factionIds
    };
}

// ============================================
// IMAGE GENERATION
// ============================================

function generateHeatmapImage(title, aggregatedData, subtitle = '') {
    const { data, min, max, days, isPercentage } = aggregatedData;
    
    const cellWidth = 55;
    const cellHeight = 28;
    const labelWidth = 60;
    const headerHeight = 50;
    const titleHeight = subtitle ? 65 : 45;
    const legendHeight = 40;
    const padding = 20;
    
    const width = labelWidth + (days.length * cellWidth) + padding * 2;
    const height = titleHeight + headerHeight + (24 * cellHeight) + legendHeight + padding * 2;
    
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
            
            let displayValue;
            if (isPercentage) {
                displayValue = `${Math.round(value)}%`;
            } else {
                displayValue = Number.isInteger(value) ? value.toString() : value.toFixed(1);
            }
            ctx.fillText(displayValue, x + cellWidth / 2, y + cellHeight / 2 + 4);
        });
    }
    
    const legendY = height - legendHeight - padding + 10;
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
    
    return canvas.toBuffer('image/png');
}

function generateCompact15MinImage(title, aggregatedData, subtitle = '') {
    const { data, min, max, days, isPercentage } = aggregatedData;
    
    const cellWidth = 75;
    const cellHeight = 24;
    const labelWidth = 60;
    const headerHeight = 50;
    const titleHeight = subtitle ? 65 : 45;
    const legendHeight = 50;
    const padding = 20;
    
    const width = labelWidth + (days.length * cellWidth) + padding * 2;
    const height = titleHeight + headerHeight + (24 * cellHeight) + legendHeight + padding * 2;
    
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
                
                let displayVal;
                if (isPercentage) {
                    displayVal = Math.round(val).toString();
                } else {
                    displayVal = Math.round(val).toString();
                }
                ctx.fillText(displayVal, subX + subWidth / 2, y + cellHeight / 2 + 3);
            }
        });
    }
    
    const legendY = height - legendHeight - padding + 10;
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
    
    return canvas.toBuffer('image/png');
}

function generateComparisonImage(title1, data1, title2, data2) {
    const days = data1.days;
    const is15Min = data1.is15Min;
    
    const cellWidth = is15Min ? 65 : 45;
    const cellHeight = 22;
    const labelWidth = 45;
    const headerHeight = 45;
    const titleHeight = 35;
    const gapWidth = 25;
    const padding = 15;
    const sectionWidth = labelWidth + (days.length * cellWidth);
    
    const width = (sectionWidth * 2) + gapWidth + padding * 2;
    const height = titleHeight + headerHeight + (24 * cellHeight) + padding * 2 + 30;
    
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#2C2F33';
    ctx.fillRect(0, 0, width, height);
    
    const globalMin = Math.min(data1.min, data2.min);
    const globalMax = Math.max(data1.max, data2.max);
    
    function drawSection(data, title, offsetX) {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 13px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(title, offsetX + sectionWidth / 2, padding + 20);
        
        ctx.font = 'bold 10px Arial';
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
    
    drawSection(data1, title1, padding);
    drawSection(data2, title2, padding + sectionWidth + gapWidth);
    
    return canvas.toBuffer('image/png');
}

function generateDifferenceImage(title1, data1, title2, data2) {
    const days = data1.days;
    const is15Min = data1.is15Min;
    
    const cellWidth = is15Min ? 75 : 55;
    const cellHeight = is15Min ? 24 : 28;
    const labelWidth = 60;
    const headerHeight = 50;
    const titleHeight = 45;
    const legendHeight = 50;
    const padding = 20;
    
    const width = labelWidth + (days.length * cellWidth) + padding * 2;
    const height = titleHeight + headerHeight + (24 * cellHeight) + legendHeight + padding * 2;
    
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
    
    const legendY = height - legendHeight - padding + 15;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`Green = ${title1} higher | Red = ${title2} higher`, width / 2, legendY + 15);
    
    return canvas.toBuffer('image/png');
}

// ============================================
// PUBLIC API
// ============================================

async function createFactionHeatmap(factionId, granularity, dayFilter) {
    const factionData = storage.loadFactionData(factionId);
    const snapshots = storage.getSnapshotsNormalized(factionData);
    
    if (!snapshots || snapshots.length === 0) {
        throw new Error(`No data available for faction ${factionId}. Wait for data collection.`);
    }
    
    const title = `${factionData.name || 'Faction'} [${factionId}]`;
    const numWeeks = getUniqueWeeks(snapshots, Math.floor(Date.now() / 1000));
    const subtitle = `Last 30 days (${numWeeks} week${numWeeks !== 1 ? 's' : ''} of data) - Avg unique active per hour`;
    
    if (granularity === '15min') {
        const aggregated = aggregateFactionData15Min(factionData, dayFilter);
        return generateCompact15MinImage(title, aggregated, subtitle);
    } else {
        const aggregated = aggregateFactionDataHourly(factionData, dayFilter);
        return generateHeatmapImage(title, aggregated, subtitle);
    }
}

async function createUserHeatmap(userId, granularity, dayFilter) {
    let aggregated;
    
    if (granularity === '15min') {
        aggregated = aggregateUserData15MinMultiFaction(userId, dayFilter);
    } else {
        aggregated = aggregateUserDataHourlyMultiFaction(userId, dayFilter);
    }
    
    if (!aggregated) {
        throw new Error(`User ${userId} not found in any tracked faction.`);
    }
    
    // Get username
    const userName = storage.getMemberName(userId) || `User`;
    const title = `${userName} [${userId}]`;
    
    // Calculate data span
    const factionData = storage.loadFactionData(aggregated.factionIds[0]);
    const snapshots = storage.getSnapshotsNormalized(factionData);
    const numWeeks = getUniqueWeeks(snapshots, Math.floor(Date.now() / 1000));
    
    const factionInfo = aggregated.factionIds.length > 1 
        ? `across ${aggregated.factionIds.length} factions` 
        : '';
    const subtitle = `Last 30 days (${numWeeks} week${numWeeks !== 1 ? 's' : ''}) - % of time active ${factionInfo}`;
    
    if (granularity === '15min') {
        return generateCompact15MinImage(title, aggregated, subtitle);
    } else {
        return generateHeatmapImage(title, aggregated, subtitle);
    }
}

async function createComparisonHeatmaps(faction1Id, faction2Id, granularity, dayFilter) {
    const faction1Data = storage.loadFactionData(faction1Id);
    const faction2Data = storage.loadFactionData(faction2Id);
    
    const snapshots1 = storage.getSnapshotsNormalized(faction1Data);
    const snapshots2 = storage.getSnapshotsNormalized(faction2Data);
    
    if (!snapshots1?.length) {
        throw new Error(`No data available for faction ${faction1Id}.`);
    }
    
    if (!snapshots2?.length) {
        throw new Error(`No data available for faction ${faction2Id}.`);
    }
    
    const name1 = faction1Data.name || `Faction ${faction1Id}`;
    const name2 = faction2Data.name || `Faction ${faction2Id}`;
    
    let agg1, agg2;
    
    if (granularity === '15min') {
        agg1 = aggregateFactionData15Min(faction1Data, dayFilter);
        agg2 = aggregateFactionData15Min(faction2Data, dayFilter);
    } else {
        agg1 = aggregateFactionDataHourly(faction1Data, dayFilter);
        agg2 = aggregateFactionDataHourly(faction2Data, dayFilter);
    }
    
    const sideBySide = generateComparisonImage(name1, agg1, name2, agg2);
    const difference = generateDifferenceImage(name1, agg1, name2, agg2);
    
    return { sideBySide, difference };
}

module.exports = {
    createFactionHeatmap,
    createUserHeatmap,
    createComparisonHeatmaps
};