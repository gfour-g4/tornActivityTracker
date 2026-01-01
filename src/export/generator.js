const storage = require('../utils/storage');
const { 
    getThirtyDaysAgo, 
    getDaysAgo,
    getDayOfWeek, 
    getHourFromTimestamp, 
    get15MinSlotInHour, 
    getWeekId,
    getUniqueWeeks 
} = require('../utils/helpers');

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];



// ============================================
// DATA AGGREGATION (same logic as web routes)
// ============================================

function aggregateHeatmapData(snapshots, granularity) {
    const now = Math.floor(Date.now() / 1000);
    const thirtyDaysAgo = getThirtyDaysAgo();
    
    if (granularity === '15min') {
        const data = {};
        for (let hour = 0; hour < 24; hour++) {
            data[hour] = {};
            for (let day = 0; day < 7; day++) {
                data[hour][day] = [
                    { weeklyUnique: {} },
                    { weeklyUnique: {} },
                    { weeklyUnique: {} },
                    { weeklyUnique: {} }
                ];
            }
        }
        
        for (const snapshot of snapshots) {
            if (snapshot.timestamp < thirtyDaysAgo) continue;
            
            const day = getDayOfWeek(snapshot.timestamp);
            const hour = getHourFromTimestamp(snapshot.timestamp);
            const slot = get15MinSlotInHour(snapshot.timestamp);
            const weekId = getWeekId(snapshot.timestamp, now);
            
            if (!data[hour][day][slot].weeklyUnique[weekId]) {
                data[hour][day][slot].weeklyUnique[weekId] = new Set();
            }
            
            for (const memberId of snapshot.active) {
                data[hour][day][slot].weeklyUnique[weekId].add(memberId);
            }
        }
        
        const result = [];
        let min = Infinity, max = -Infinity;
        
        for (let hour = 0; hour < 24; hour++) {
            const row = [];
            for (let day = 0; day < 7; day++) {
                const slots = [];
                for (let slot = 0; slot < 4; slot++) {
                    const weekData = data[hour][day][slot].weeklyUnique;
                    const weekIds = Object.keys(weekData);
                    
                    let avg = 0;
                    if (weekIds.length > 0) {
                        let total = 0;
                        for (const wid of weekIds) {
                            total += weekData[wid].size;
                        }
                        avg = Math.round(total / weekIds.length * 10) / 10;
                    }
                    
                    slots.push(avg);
                    if (avg < min) min = avg;
                    if (avg > max) max = avg;
                }
                row.push(slots);
            }
            result.push(row);
        }
        
        return { data: result, min, max, is15Min: true };
    } else {
        const data = {};
        for (let hour = 0; hour < 24; hour++) {
            data[hour] = {};
            for (let day = 0; day < 7; day++) {
                data[hour][day] = {};
            }
        }
        
        for (const snapshot of snapshots) {
            if (snapshot.timestamp < thirtyDaysAgo) continue;
            
            const day = getDayOfWeek(snapshot.timestamp);
            const hour = getHourFromTimestamp(snapshot.timestamp);
            const weekId = getWeekId(snapshot.timestamp, now);
            
            if (!data[hour][day][weekId]) {
                data[hour][day][weekId] = new Set();
            }
            
            for (const memberId of snapshot.active) {
                data[hour][day][weekId].add(memberId);
            }
        }
        
        const result = [];
        let min = Infinity, max = -Infinity;
        
        for (let hour = 0; hour < 24; hour++) {
            const row = [];
            for (let day = 0; day < 7; day++) {
                const weekData = data[hour][day];
                const weekIds = Object.keys(weekData);
                
                let avg = 0;
                if (weekIds.length > 0) {
                    let total = 0;
                    for (const wid of weekIds) {
                        total += weekData[wid].size;
                    }
                    avg = Math.round(total / weekIds.length * 10) / 10;
                }
                
                row.push(avg);
                if (avg < min) min = avg;
                if (avg > max) max = avg;
            }
            result.push(row);
        }
        
        return { data: result, min: min === Infinity ? 0 : min, max: max === -Infinity ? 0 : max };
    }
}

function aggregateMemberHeatmapData(snapshots, memberId, granularity) {
    const thirtyDaysAgo = getThirtyDaysAgo();
    const now = Math.floor(Date.now() / 1000);
    
    if (granularity === '15min') {
        const data = {};
        for (let hour = 0; hour < 24; hour++) {
            data[hour] = {};
            for (let day = 0; day < 7; day++) {
                data[hour][day] = [
                    { total: 0, active: 0 },
                    { total: 0, active: 0 },
                    { total: 0, active: 0 },
                    { total: 0, active: 0 }
                ];
            }
        }
        
        const processed = new Set();
        
        for (const snapshot of snapshots) {
            if (snapshot.timestamp < thirtyDaysAgo) continue;
            
            const key = snapshot.timestamp.toString();
            if (processed.has(key)) continue;
            processed.add(key);
            
            const day = getDayOfWeek(snapshot.timestamp);
            const hour = getHourFromTimestamp(snapshot.timestamp);
            const slot = get15MinSlotInHour(snapshot.timestamp);
            
            data[hour][day][slot].total++;
            if (snapshot.active.includes(memberId)) {
                data[hour][day][slot].active++;
            }
        }
        
        const result = [];
        for (let hour = 0; hour < 24; hour++) {
            const row = [];
            for (let day = 0; day < 7; day++) {
                const slots = [];
                for (let slot = 0; slot < 4; slot++) {
                    const { total, active } = data[hour][day][slot];
                    slots.push(total === 0 ? 0 : Math.round((active / total) * 100));
                }
                row.push(slots);
            }
            result.push(row);
        }
        
        return { data: result, min: 0, max: 100, isPercentage: true, is15Min: true };
    } else {
        const data = {};
        for (let hour = 0; hour < 24; hour++) {
            data[hour] = {};
            for (let day = 0; day < 7; day++) {
                data[hour][day] = { weeksWithData: new Set(), weeksActive: new Set() };
            }
        }
        
        for (const snapshot of snapshots) {
            if (snapshot.timestamp < thirtyDaysAgo) continue;
            
            const day = getDayOfWeek(snapshot.timestamp);
            const hour = getHourFromTimestamp(snapshot.timestamp);
            const weekId = `${snapshot.factionId || 0}-${getWeekId(snapshot.timestamp, now)}`;
            
            data[hour][day].weeksWithData.add(weekId);
            if (snapshot.active.includes(memberId)) {
                data[hour][day].weeksActive.add(weekId);
            }
        }
        
        const result = [];
        for (let hour = 0; hour < 24; hour++) {
            const row = [];
            for (let day = 0; day < 7; day++) {
                const { weeksWithData, weeksActive } = data[hour][day];
                const pct = weeksWithData.size === 0 ? 0 : Math.round((weeksActive.size / weeksWithData.size) * 100);
                row.push(pct);
            }
            result.push(row);
        }
        
        return { data: result, min: 0, max: 100, isPercentage: true };
    }
}

function calculateMemberStats(snapshots, memberId) {
    const thirtyDaysAgo = getThirtyDaysAgo();
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
    
    let total30d = 0, active30d = 0;
    let total7d = 0, active7d = 0;
    
    const processed = new Set();
    
    for (const snapshot of snapshots) {
        const key = snapshot.timestamp.toString();
        if (processed.has(key)) continue;
        processed.add(key);
        
        if (snapshot.timestamp >= thirtyDaysAgo) {
            total30d++;
            if (snapshot.active.includes(memberId)) active30d++;
        }
        
        if (snapshot.timestamp >= sevenDaysAgo) {
            total7d++;
            if (snapshot.active.includes(memberId)) active7d++;
        }
    }
    
    return {
        activityScore: total30d === 0 ? 0 : Math.round((active30d / total30d) * 100),
        activity7d: total7d === 0 ? 0 : Math.round((active7d / total7d) * 100),
        activity30d: total30d === 0 ? 0 : Math.round((active30d / total30d) * 100)
    };
}

// ============================================
// HTML TEMPLATE
// ============================================

function getBaseHTML(title, content, data) {
    const generatedAt = new Date().toISOString();
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)} - Torn Activity Report</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>${getCSS()}</style>
</head>
<body>
    <div class="container">
        <header class="header">
            <div class="brand">
                <span class="brand-icon">📊</span>
                <span class="brand-text">Torn Activity Report</span>
            </div>
            <div class="generated">Generated: ${generatedAt}</div>
        </header>
        
        ${content}
        
        <footer class="footer">
            <p>Generated by Torn Activity Bot</p>
        </footer>
    </div>
    
    <script>
        const DATA = ${JSON.stringify(data)};
        ${getJS()}
    </script>
</body>
</html>`;
}

function getCSS() {
    return `
:root {
    --bg-primary: #09090b;
    --bg-secondary: #18181b;
    --bg-tertiary: #27272a;
    --bg-hover: #3f3f46;
    --text-primary: #fafafa;
    --text-secondary: #a1a1aa;
    --text-muted: #52525b;
    --accent: #8b5cf6;
    --success: #10b981;
    --warning: #f59e0b;
    --danger: #ef4444;
    --border: rgba(255, 255, 255, 0.1);
}

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background: var(--bg-primary);
    color: var(--text-primary);
    line-height: 1.6;
    min-height: 100vh;
    background-image: 
        radial-gradient(ellipse 80% 50% at 50% -20%, rgba(139, 92, 246, 0.15), transparent),
        radial-gradient(ellipse 60% 40% at 100% 100%, rgba(34, 211, 238, 0.1), transparent);
}

.container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 2rem;
}

.header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border);
}

.brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
}

.brand-icon {
    font-size: 1.5rem;
}

.brand-text {
    font-size: 1.25rem;
    font-weight: 600;
    background: linear-gradient(135deg, var(--accent), #22d3ee);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

.generated {
    color: var(--text-muted);
    font-size: 0.875rem;
}

.page-title {
    font-size: 2.5rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
    letter-spacing: -0.025em;
}

.page-subtitle {
    color: var(--text-secondary);
    font-size: 1rem;
    margin-bottom: 2rem;
}

.page-subtitle a {
    color: var(--accent);
    text-decoration: none;
}

.card {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
}

.card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
}

.card-title {
    font-size: 1.125rem;
    font-weight: 600;
}

.stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
}

.stat-card {
    background: var(--bg-tertiary);
    border-radius: 12px;
    padding: 1.25rem;
    text-align: center;
    border: 1px solid var(--border);
}

.stat-value {
    font-size: 2rem;
    font-weight: 700;
    margin-bottom: 0.25rem;
}

.stat-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.text-success { color: var(--success); }
.text-warning { color: var(--warning); }
.text-danger { color: var(--danger); }
.text-muted { color: var(--text-muted); }

/* Tabs */
.tabs {
    display: flex;
    gap: 0.25rem;
    background: var(--bg-tertiary);
    padding: 4px;
    border-radius: 10px;
    margin-bottom: 1.5rem;
    width: fit-content;
}

.tab {
    padding: 0.5rem 1.25rem;
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    border-radius: 6px;
    font-family: inherit;
    transition: all 0.2s;
}

.tab:hover {
    color: var(--text-primary);
}

.tab.active {
    color: var(--text-primary);
    background: var(--bg-secondary);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

/* Heatmap */
.heatmap-wrapper {
    background: var(--bg-tertiary);
    border-radius: 12px;
    padding: 1.5rem;
}

.heatmap {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
}

.heatmap-header {
    display: flex;
    gap: 3px;
    padding-left: 50px;
    margin-bottom: 8px;
}

.heatmap-header-cell {
    flex: 1;
    text-align: center;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-secondary);
    padding: 8px 0;
}

.heatmap-row {
    display: flex;
    gap: 3px;
    align-items: stretch;
}

.heatmap-label {
    width: 50px;
    min-width: 50px;
    font-size: 0.75rem;
    color: var(--text-muted);
    text-align: right;
    padding-right: 10px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    font-family: 'SF Mono', 'Fira Code', monospace;
}

.heatmap-cell {
    flex: 1;
    min-height: 36px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.85rem;
    font-weight: 600;
    transition: all 0.2s;
    cursor: default;
    font-family: 'SF Mono', 'Fira Code', monospace;
}

.heatmap-cell:hover {
    transform: scale(1.05);
    z-index: 10;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

.heatmap-cell-group {
    flex: 1;
    display: flex;
    gap: 2px;
    background: var(--bg-primary);
    border-radius: 6px;
    padding: 3px;
    min-height: 36px;
}

.heatmap-subcell {
    flex: 1;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    font-weight: 600;
    transition: all 0.2s;
    font-family: 'SF Mono', 'Fira Code', monospace;
}

.heatmap-subcell:hover {
    transform: scale(1.1);
    z-index: 10;
}

.heatmap-legend {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    margin-top: 1.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--border);
}

.legend-label {
    font-size: 0.8rem;
    color: var(--text-muted);
    font-weight: 500;
}

.legend-gradient {
    width: 250px;
    height: 12px;
    border-radius: 6px;
    background: linear-gradient(90deg, #1c1c24, #4c2d8c, #7c4fd6, #a78bfa, #2dd4bf);
}

.legend-markers {
    display: flex;
    justify-content: space-between;
    width: 250px;
    margin-top: 6px;
}

.legend-marker {
    font-size: 0.7rem;
    color: var(--text-muted);
    font-family: 'SF Mono', 'Fira Code', monospace;
}

/* Member List */
.member-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 600px;
    overflow-y: auto;
}

.member-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.875rem 1rem;
    background: var(--bg-tertiary);
    border-radius: 10px;
    transition: all 0.2s;
    border: 1px solid transparent;
}

.member-item:hover {
    background: var(--bg-hover);
    border-color: var(--border);
}

.member-avatar {
    width: 42px;
    height: 42px;
    border-radius: 10px;
    background: linear-gradient(135deg, var(--accent), #22d3ee);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    color: white;
    font-size: 1rem;
    flex-shrink: 0;
}

.member-info {
    flex: 1;
    min-width: 0;
}

.member-name {
    font-weight: 500;
    margin-bottom: 0.125rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.member-id {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-family: 'SF Mono', 'Fira Code', monospace;
}

.member-activity {
    text-align: right;
    flex-shrink: 0;
}

.activity-bar {
    width: 120px;
    height: 8px;
    background: var(--bg-primary);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 0.25rem;
}

.activity-fill {
    height: 100%;
    border-radius: 4px;
    background: linear-gradient(90deg, var(--accent), #22d3ee);
}

.activity-text {
    font-size: 0.75rem;
    color: var(--text-secondary);
    font-family: 'SF Mono', 'Fira Code', monospace;
}

.status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
    background: var(--success);
    box-shadow: 0 0 8px var(--success);
}

.search-input {
    width: 100%;
    max-width: 400px;
    padding: 0.875rem 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 10px;
    color: var(--text-primary);
    font-size: 0.875rem;
    margin-bottom: 1rem;
    font-family: inherit;
}

.search-input:focus {
    outline: none;
    border-color: var(--accent);
}

.search-input::placeholder {
    color: var(--text-muted);
}

.footer {
    margin-top: 3rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--border);
    text-align: center;
    color: var(--text-muted);
    font-size: 0.875rem;
}

.hidden {
    display: none !important;
}

@media (max-width: 768px) {
    .container {
        padding: 1rem;
    }
    
    .page-title {
        font-size: 1.75rem;
    }
    
    .header {
        flex-direction: column;
        gap: 1rem;
        text-align: center;
    }
    
    .heatmap-cell {
        font-size: 0.7rem;
        min-height: 30px;
    }
    
    .heatmap-subcell {
        font-size: 0.55rem;
    }
}
`;
}

function getJS() {
    return `
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getHeatmapColor(value, min, max) {
    if (max === min) return '#4c2d8c';
    
    const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
    
    const colors = [
        { r: 28, g: 28, b: 36 },
        { r: 45, g: 31, b: 78 },
        { r: 59, g: 38, b: 112 },
        { r: 76, g: 45, b: 140 },
        { r: 91, g: 53, b: 168 },
        { r: 109, g: 63, b: 196 },
        { r: 124, g: 79, b: 214 },
        { r: 139, g: 92, b: 246 },
        { r: 167, g: 139, b: 250 },
        { r: 34, g: 211, b: 238 },
        { r: 45, g: 212, b: 191 },
    ];
    
    const index = ratio * (colors.length - 1);
    const lower = Math.floor(index);
    const upper = Math.min(lower + 1, colors.length - 1);
    const t = index - lower;
    
    const r = Math.round(colors[lower].r + (colors[upper].r - colors[lower].r) * t);
    const g = Math.round(colors[lower].g + (colors[upper].g - colors[lower].g) * t);
    const b = Math.round(colors[lower].b + (colors[upper].b - colors[lower].b) * t);
    
    return 'rgb(' + r + ',' + g + ',' + b + ')';
}

function getContrastColor(value, min, max) {
    const ratio = max > min ? (value - min) / (max - min) : 0;
    return ratio > 0.65 ? '#000' : 'rgba(255,255,255,0.9)';
}

function renderHeatmap(heatmapData, containerId) {
    const { data, min, max, isPercentage, is15Min } = heatmapData;
    const container = document.getElementById(containerId);
    
    let html = '<div class="heatmap">';
    
    html += '<div class="heatmap-header">';
    for (const day of DAYS) {
        html += '<div class="heatmap-header-cell">' + day + '</div>';
    }
    html += '</div>';
    
    for (let hour = 0; hour < 24; hour++) {
        html += '<div class="heatmap-row">';
        html += '<div class="heatmap-label">' + hour.toString().padStart(2, '0') + ':00</div>';
        
        for (let day = 0; day < 7; day++) {
            if (is15Min) {
                const slots = data[hour][day];
                html += '<div class="heatmap-cell-group">';
                for (let slot = 0; slot < 4; slot++) {
                    const value = slots[slot];
                    const color = getHeatmapColor(value, min, max);
                    const textColor = getContrastColor(value, min, max);
                    const displayVal = isPercentage ? Math.round(value) : (Number.isInteger(value) ? value : value.toFixed(1));
                    
                    html += '<div class="heatmap-subcell" style="background:' + color + ';color:' + textColor + '" title="' + DAYS[day] + ' ' + hour + ':' + (slot * 15) + ' - ' + (isPercentage ? value + '%' : value) + '">' + displayVal + '</div>';
                }
                html += '</div>';
            } else {
                const value = data[hour][day];
                const color = getHeatmapColor(value, min, max);
                const textColor = getContrastColor(value, min, max);
                const displayVal = isPercentage ? Math.round(value) + '%' : (Number.isInteger(value) ? value : value.toFixed(1));
                
                html += '<div class="heatmap-cell" style="background:' + color + ';color:' + textColor + '" title="' + DAYS[day] + ' ' + hour + ':00 - ' + (isPercentage ? value + '%' : value) + '">' + displayVal + '</div>';
            }
        }
        
        html += '</div>';
    }
    
    html += '</div>';
    
    const minLabel = isPercentage ? '0%' : min;
    const maxLabel = isPercentage ? '100%' : max;
    
    html += '<div class="heatmap-legend">';
    html += '<span class="legend-label">Less</span>';
    html += '<div>';
    html += '<div class="legend-gradient"></div>';
    html += '<div class="legend-markers"><span class="legend-marker">' + minLabel + '</span><span class="legend-marker">' + maxLabel + '</span></div>';
    html += '</div>';
    html += '<span class="legend-label">More</span>';
    html += '</div>';
    
    container.innerHTML = html;
}

function switchTab(type) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelector('[data-type="' + type + '"]').classList.add('active');
    
    const heatmap = type === '15min' ? DATA.heatmap15Min : DATA.heatmap;
    renderHeatmap(heatmap, 'heatmap-container');
}

function filterMembers(query) {
    const q = query.toLowerCase();
    document.querySelectorAll('.member-item').forEach(item => {
        const name = item.dataset.name;
        const id = item.dataset.id;
        const match = name.includes(q) || id.includes(q);
        item.classList.toggle('hidden', !match);
    });
}

document.addEventListener('DOMContentLoaded', function() {
    if (DATA.heatmap) {
        renderHeatmap(DATA.heatmap, 'heatmap-container');
    }
});
`;
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ============================================
// GENERATORS
// ============================================

async function generateFactionHTML(factionId) {
    const factionData = storage.loadFactionData(factionId);
    const snapshots = storage.getSnapshotsNormalized(factionData);
    
    if (!snapshots || snapshots.length === 0) {
        throw new Error(`No data available for faction ${factionId}`);
    }
    
    const latest = snapshots[snapshots.length - 1];
    const numWeeks = getUniqueWeeks(snapshots, Math.floor(Date.now() / 1000));
    
    // Get heatmap data
    const heatmap = aggregateHeatmapData(snapshots, 'hourly');
    const heatmap15Min = aggregateHeatmapData(snapshots, '15min');
    
    // Get member list
    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
    const memberIds = new Set();
    
    for (const snapshot of snapshots) {
        if (snapshot.timestamp >= oneDayAgo) {
            for (const id of snapshot.active) {
                memberIds.add(id);
            }
        }
    }
    
    const members = [];
    for (const memberId of memberIds) {
        const name = storage.getMemberName(memberId) || `User ${memberId}`;
        const stats = calculateMemberStats(snapshots, memberId);
        
        members.push({
            id: memberId,
            name,
            ...stats,
            isOnline: latest.active.includes(memberId)
        });
    }
    
    members.sort((a, b) => b.activityScore - a.activityScore);
    
    const data = {
        heatmap,
        heatmap15Min,
        members
    };
    
    const content = `
        <h1 class="page-title">${escapeHtml(factionData.name || 'Faction')}</h1>
        <p class="page-subtitle">#${factionId} • ${numWeeks} weeks of data • ${snapshots.length} data points</p>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${latest.total}</div>
                <div class="stat-label">Total Members</div>
            </div>
            <div class="stat-card">
                <div class="stat-value text-success">${latest.active.length}</div>
                <div class="stat-label">Last Seen Online</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${snapshots.length}</div>
                <div class="stat-label">Data Points</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${numWeeks}</div>
                <div class="stat-label">Weeks Tracked</div>
            </div>
        </div>
        
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">📊 Activity Heatmap</h3>
                <span class="text-muted">Average unique active members</span>
            </div>
            <div class="tabs">
                <button class="tab active" data-type="hourly" onclick="switchTab('hourly')">Hourly</button>
                <button class="tab" data-type="15min" onclick="switchTab('15min')">15 Minute</button>
            </div>
            <div class="heatmap-wrapper">
                <div id="heatmap-container"></div>
            </div>
        </div>
        
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">👥 Members</h3>
                <span class="text-muted">${members.length} tracked</span>
            </div>
            <input type="text" class="search-input" placeholder="Search members..." oninput="filterMembers(this.value)">
            <div class="member-list">
                ${members.map(m => `
                    <div class="member-item" data-name="${m.name.toLowerCase()}" data-id="${m.id}">
                        <div class="member-avatar">${m.name.charAt(0).toUpperCase()}</div>
                        <div class="member-info">
                            <div class="member-name">
                                ${escapeHtml(m.name)}
                                ${m.isOnline ? '<span class="status-dot"></span>' : ''}
                            </div>
                            <div class="member-id">#${m.id}</div>
                        </div>
                        <div class="member-activity">
                            <div class="activity-bar">
                                <div class="activity-fill" style="width: ${m.activityScore}%"></div>
                            </div>
                            <div class="activity-text">${m.activityScore}% active</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    
    return getBaseHTML(factionData.name || `Faction ${factionId}`, content, data);
}

async function generateMemberHTML(memberId) {
    const factionIds = storage.findUserInAllFactions(memberId);
    
    if (factionIds.length === 0) {
        throw new Error(`Member ${memberId} not found in any tracked faction`);
    }
    
    const memberName = storage.getMemberName(memberId) || `User ${memberId}`;
    
    // Aggregate snapshots from all factions
    const allSnapshots = [];
    const factionNames = {};
    
    for (const factionId of factionIds) {
        const factionData = storage.loadFactionData(factionId);
        const snapshots = storage.getSnapshotsNormalized(factionData);
        factionNames[factionId] = factionData.name || `Faction ${factionId}`;
        
        for (const snapshot of snapshots) {
            allSnapshots.push({
                ...snapshot,
                factionId
            });
        }
    }
    
    allSnapshots.sort((a, b) => a.timestamp - b.timestamp);
    
    const heatmap = aggregateMemberHeatmapData(allSnapshots, memberId, 'hourly');
    const heatmap15Min = aggregateMemberHeatmapData(allSnapshots, memberId, '15min');
    const stats = calculateMemberStats(allSnapshots, memberId);
    
    const numWeeks = getUniqueWeeks(allSnapshots, Math.floor(Date.now() / 1000));
    
    const data = {
        heatmap,
        heatmap15Min
    };
    
    const factionLinks = factionIds.map(id => 
        `<a href="https://www.torn.com/factions.php?step=profile&ID=${id}" target="_blank">${escapeHtml(factionNames[id])}</a>`
    ).join(', ');
    
    const content = `
        <h1 class="page-title">${escapeHtml(memberName)}</h1>
        <p class="page-subtitle">
            <a href="https://www.torn.com/profiles.php?XID=${memberId}" target="_blank">#${memberId}</a> • 
            ${factionLinks}
        </p>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value" style="color: ${stats.activity7d >= 60 ? 'var(--success)' : stats.activity7d >= 30 ? 'var(--warning)' : 'var(--danger)'}">${stats.activity7d}%</div>
                <div class="stat-label">7 Day Activity</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" style="color: ${stats.activity30d >= 60 ? 'var(--success)' : stats.activity30d >= 30 ? 'var(--warning)' : 'var(--danger)'}">${stats.activity30d}%</div>
                <div class="stat-label">30 Day Activity</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${numWeeks}</div>
                <div class="stat-label">Weeks Tracked</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${allSnapshots.length}</div>
                <div class="stat-label">Data Points</div>
            </div>
        </div>
        
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">📊 Activity Pattern</h3>
                <span class="text-muted">Percentage of time active</span>
            </div>
            <div class="tabs">
                <button class="tab active" data-type="hourly" onclick="switchTab('hourly')">Hourly</button>
                <button class="tab" data-type="15min" onclick="switchTab('15min')">15 Minute</button>
            </div>
            <div class="heatmap-wrapper">
                <div id="heatmap-container"></div>
            </div>
        </div>
    `;
    
    return getBaseHTML(memberName, content, data);
}

module.exports = {
    generateFactionHTML,
    generateMemberHTML
};