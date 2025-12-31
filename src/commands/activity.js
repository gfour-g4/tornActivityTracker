const { SlashCommandBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const heatmap = require('../heatmap');
const storage = require('../utils/storage');
const hof = require('../utils/hof');
const api = require('../utils/api');
const collector = require('../collector');

const GRANULARITY_CHOICES = [
    { name: 'Hourly', value: 'hourly' },
    { name: '15 Minutes', value: '15min' }
];

const RANK_CHOICES = [
    { name: 'Platinum', value: 'platinum' },
    { name: 'Diamond', value: 'diamond' }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('activity')
        .setDescription('Activity tracking and management')
        // Heatmap subcommands
        .addSubcommand(subcommand =>
            subcommand
                .setName('faction')
                .setDescription('View faction activity heatmap')
                .addStringOption(option =>
                    option
                        .setName('faction')
                        .setDescription('Faction name or ID')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addStringOption(option =>
                    option
                        .setName('granularity')
                        .setDescription('Time granularity')
                        .addChoices(...GRANULARITY_CHOICES)
                )
                .addStringOption(option =>
                    option
                        .setName('days')
                        .setDescription('Days to include (all, weekday, weekend, or: mon,tue,wed)')
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('user')
                .setDescription('View user activity heatmap')
                .addStringOption(option =>
                    option
                        .setName('user')
                        .setDescription('Username or ID')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addStringOption(option =>
                    option
                        .setName('granularity')
                        .setDescription('Time granularity')
                        .addChoices(...GRANULARITY_CHOICES)
                )
                .addStringOption(option =>
                    option
                        .setName('days')
                        .setDescription('Days to include (all, weekday, weekend, or: mon,tue,wed)')
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('compare')
                .setDescription('Compare two factions')
                .addStringOption(option =>
                    option
                        .setName('faction1')
                        .setDescription('First faction name or ID')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addStringOption(option =>
                    option
                        .setName('faction2')
                        .setDescription('Second faction name or ID')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addStringOption(option =>
                    option
                        .setName('granularity')
                        .setDescription('Time granularity')
                        .addChoices(...GRANULARITY_CHOICES)
                )
                .addStringOption(option =>
                    option
                        .setName('days')
                        .setDescription('Days to include')
                )
        )
        // Management subcommands
        .addSubcommand(subcommand =>
            subcommand
                .setName('add-factions')
                .setDescription('Add factions to track by ID')
                .addStringOption(option =>
                    option
                        .setName('ids')
                        .setDescription('Comma-separated faction IDs')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('add-rank')
                .setDescription('Add all factions of a certain rank')
                .addStringOption(option =>
                    option
                        .setName('rank')
                        .setDescription('Faction rank')
                        .setRequired(true)
                        .addChoices(...RANK_CHOICES)
                )
                .addIntegerOption(option =>
                    option
                        .setName('max-members')
                        .setDescription('Maximum member count (optional)')
                        .setMinValue(1)
                        .setMaxValue(100)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('add-keys')
                .setDescription('Add API keys')
                .addStringOption(option =>
                    option
                        .setName('keys')
                        .setDescription('Comma-separated API keys')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove-factions')
                .setDescription('Remove factions from tracking')
                .addStringOption(option =>
                    option
                        .setName('ids')
                        .setDescription('Comma-separated faction IDs')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove-rank')
                .setDescription('Remove all factions of a certain rank')
                .addStringOption(option =>
                    option
                        .setName('rank')
                        .setDescription('Faction rank')
                        .setRequired(true)
                        .addChoices(...RANK_CHOICES)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove-key')
                .setDescription('Remove an API key')
                .addStringOption(option =>
                    option
                        .setName('key')
                        .setDescription('API key to remove')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('Show current configuration')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Show collector status and rate limits')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('collect')
                .setDescription('Manually trigger data collection')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('refresh-hof')
                .setDescription('Manually refresh the faction Hall of Fame cache')
        ),

    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);
        const value = focusedOption.value;
        
        let choices = [];
        
        if (focusedOption.name === 'user') {
            if (value.length === 0) {
                choices = storage.getAllMemberChoices();
            } else {
                choices = storage.searchMemberByName(value).map(m => ({
                    name: `${m.name} [${m.id}]`,
                    value: m.id.toString()
                }));
            }
        } else if (['faction', 'faction1', 'faction2'].includes(focusedOption.name)) {
            if (value.length === 0) {
                choices = storage.getAllFactionChoices();
            } else {
                // Search both tracked factions and HOF
                const tracked = storage.searchFactionByName(value);
                const hofResults = hof.searchHOFByName(value);
                
                // Merge results, prioritizing tracked factions
                const seen = new Set(tracked.map(f => f.id));
                const merged = [...tracked];
                
                for (const f of hofResults) {
                    if (!seen.has(f.id)) {
                        merged.push(f);
                        seen.add(f.id);
                    }
                }
                
                choices = merged.slice(0, 25).map(f => ({
                    name: `${f.name} [${f.id}]`,
                    value: f.id.toString()
                }));
            }
        }
        
        await interaction.respond(choices.slice(0, 25));
    },

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        // Heatmap commands
        if (subcommand === 'faction') {
            return await handleFactionHeatmap(interaction);
        }
        
        if (subcommand === 'user') {
            return await handleUserHeatmap(interaction);
        }
        
        if (subcommand === 'compare') {
            return await handleCompare(interaction);
        }
        
        // Management commands (admin only)
        const adminCommands = ['add-factions', 'add-rank', 'add-keys', 'remove-factions', 'remove-rank', 'remove-key', 'collect', 'refresh-hof'];
        
        if (adminCommands.includes(subcommand)) {
            if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
                return await interaction.reply({
                    content: '❌ This command requires Administrator permissions.',
                    ephemeral: true
                });
            }
        }
        
        if (subcommand === 'add-factions') {
            return await handleAddFactions(interaction);
        }
        
        if (subcommand === 'add-rank') {
            return await handleAddRank(interaction);
        }
        
        if (subcommand === 'add-keys') {
            return await handleAddKeys(interaction);
        }
        
        if (subcommand === 'remove-factions') {
            return await handleRemoveFactions(interaction);
        }
        
        if (subcommand === 'remove-rank') {
            return await handleRemoveRank(interaction);
        }
        
        if (subcommand === 'remove-key') {
            return await handleRemoveKey(interaction);
        }
        
        if (subcommand === 'list') {
            return await handleList(interaction);
        }
        
        if (subcommand === 'status') {
            return await handleStatus(interaction);
        }
        
        if (subcommand === 'collect') {
            return await handleCollect(interaction);
        }
        
        if (subcommand === 'refresh-hof') {
            return await handleRefreshHOF(interaction);
        }
    }
};

// ============================================
// HEATMAP HANDLERS
// ============================================

async function handleFactionHeatmap(interaction) {
    const input = interaction.options.getString('faction');
    const granularity = interaction.options.getString('granularity') || 'hourly';
    const days = interaction.options.getString('days') || 'all';
    
    await interaction.deferReply();
    
    try {
        const faction = storage.resolveFaction(input);
        
        if (!faction) {
            return await interaction.editReply({
                content: `❌ Faction not found: "${input}"\nUse a faction name or ID from the tracked list.`
            });
        }
        
        const imageBuffer = await heatmap.createFactionHeatmap(faction.id, granularity, days);
        
        const attachment = new AttachmentBuilder(imageBuffer, { 
            name: `faction_${faction.id}_activity.png` 
        });
        
        await interaction.editReply({ files: [attachment] });
        
    } catch (error) {
        console.error('Faction heatmap error:', error);
        await interaction.editReply({ content: `❌ Error: ${error.message}` });
    }
}

async function handleUserHeatmap(interaction) {
    const input = interaction.options.getString('user');
    const granularity = interaction.options.getString('granularity') || 'hourly';
    const days = interaction.options.getString('days') || 'all';
    
    await interaction.deferReply();
    
    try {
        const member = storage.resolveMember(input);
        
        if (!member) {
            return await interaction.editReply({
                content: `❌ User not found: "${input}"\nThe user must have been active in a tracked faction.`
            });
        }
        
        const imageBuffer = await heatmap.createUserHeatmap(member.id, granularity, days);
        
        const attachment = new AttachmentBuilder(imageBuffer, { 
            name: `user_${member.id}_activity.png` 
        });
        
        await interaction.editReply({ files: [attachment] });
        
    } catch (error) {
        console.error('User heatmap error:', error);
        await interaction.editReply({ content: `❌ Error: ${error.message}` });
    }
}

async function handleCompare(interaction) {
    const input1 = interaction.options.getString('faction1');
    const input2 = interaction.options.getString('faction2');
    const granularity = interaction.options.getString('granularity') || 'hourly';
    const days = interaction.options.getString('days') || 'all';
    
    await interaction.deferReply();
    
    try {
        const faction1 = storage.resolveFaction(input1);
        const faction2 = storage.resolveFaction(input2);
        
        if (!faction1) {
            return await interaction.editReply({ content: `❌ First faction not found: "${input1}"` });
        }
        
        if (!faction2) {
            return await interaction.editReply({ content: `❌ Second faction not found: "${input2}"` });
        }
        
        const { sideBySide, difference } = await heatmap.createComparisonHeatmaps(
            faction1.id, faction2.id, granularity, days
        );
        
        const attachment1 = new AttachmentBuilder(sideBySide, { name: 'comparison_side_by_side.png' });
        const attachment2 = new AttachmentBuilder(difference, { name: 'comparison_difference.png' });
        
        await interaction.editReply({ 
            content: `**${faction1.name}** vs **${faction2.name}**`,
            files: [attachment1] 
        });
        
        await interaction.followUp({ 
            content: '**Difference heatmap:**',
            files: [attachment2] 
        });
        
    } catch (error) {
        console.error('Compare error:', error);
        await interaction.editReply({ content: `❌ Error: ${error.message}` });
    }
}

// ============================================
// MANAGEMENT HANDLERS
// ============================================

async function handleAddFactions(interaction) {
    const idsInput = interaction.options.getString('ids');
    
    const ids = idsInput.split(',')
        .map(id => parseInt(id.trim()))
        .filter(id => !isNaN(id));
    
    if (ids.length === 0) {
        return await interaction.reply({
            content: '❌ No valid faction IDs provided.',
            ephemeral: true
        });
    }
    
    const result = storage.addFactionsByIds(ids);
    
    await interaction.reply({
        content: `✅ Added **${result.added}** faction(s)` + 
            (result.skipped > 0 ? ` (${result.skipped} already tracked)` : ''),
        ephemeral: true
    });
}

async function handleAddRank(interaction) {
    const rank = interaction.options.getString('rank');
    const maxMembers = interaction.options.getInteger('max-members');
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
        // Ensure HOF cache is up to date
        await hof.ensureHOFCache();
        
        const result = storage.addFactionsByRank(rank, maxMembers);
        
        let response = `✅ Added **${result.added}** ${rank} faction(s)`;
        
        if (result.skipped > 0) {
            response += ` (${result.skipped} already tracked)`;
        }
        
        if (maxMembers) {
            response += `\n📊 Filter: max ${maxMembers} members`;
        }
        
        if (result.added > 0 && result.added <= 10) {
            response += '\n\n**Added:**\n' + result.factions.map(f => 
                `• ${f.name} [${f.id}] - ${f.members} members`
            ).join('\n');
        }
        
        // Show estimate
        const config = storage.loadConfig();
        const estimate = api.estimateCollectionTime(config.factions.length);
        response += `\n\n📈 Now tracking **${config.factions.length}** factions`;
        response += `\n⏱️ Est. collection time: **${Math.ceil(estimate / 60)}** minutes`;
        
        if (estimate > 14 * 60) {
            response += `\n⚠️ Warning: Collection may not complete in 15 min. Add more API keys.`;
        }
        
        await interaction.editReply({ content: response });
        
    } catch (error) {
        console.error('Add rank error:', error);
        await interaction.editReply({ content: `❌ Error: ${error.message}` });
    }
}

async function handleAddKeys(interaction) {
    const keysInput = interaction.options.getString('keys');
    
    const keys = keysInput.split(',')
        .map(k => k.trim())
        .filter(k => k.length > 0);
    
    if (keys.length === 0) {
        return await interaction.reply({
            content: '❌ No valid API keys provided.',
            ephemeral: true
        });
    }
    
    const result = storage.addApiKeys(keys);
    
    await interaction.reply({
        content: `✅ Added **${result.added}** API key(s)` + 
            (result.skipped > 0 ? ` (${result.skipped} already exist)` : ''),
        ephemeral: true
    });
}

async function handleRemoveFactions(interaction) {
    const idsInput = interaction.options.getString('ids');
    
    const ids = idsInput.split(',')
        .map(id => parseInt(id.trim()))
        .filter(id => !isNaN(id));
    
    if (ids.length === 0) {
        return await interaction.reply({
            content: '❌ No valid faction IDs provided.',
            ephemeral: true
        });
    }
    
    const result = storage.removeFactionsByIds(ids);
    
    await interaction.reply({
        content: result.removed > 0 
            ? `✅ Removed **${result.removed}** faction(s)`
            : '⚠️ No matching factions found to remove.',
        ephemeral: true
    });
}

async function handleRemoveRank(interaction) {
    const rank = interaction.options.getString('rank');
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
        await hof.ensureHOFCache();
        
        const result = storage.removeFactionsByRank(rank);
        
        let response = result.removed > 0
            ? `✅ Removed **${result.removed}** ${rank} faction(s)`
            : `⚠️ No ${rank} factions were being tracked.`;
        
        if (result.removed > 0 && result.removed <= 10) {
            response += '\n\n**Removed:**\n' + result.factions.map(f => 
                `• ${f.name} [${f.id}]`
            ).join('\n');
        }
        
        const config = storage.loadConfig();
        response += `\n\n📈 Now tracking **${config.factions.length}** factions`;
        
        await interaction.editReply({ content: response });
        
    } catch (error) {
        console.error('Remove rank error:', error);
        await interaction.editReply({ content: `❌ Error: ${error.message}` });
    }
}

async function handleRemoveKey(interaction) {
    const key = interaction.options.getString('key');
    
    const result = storage.removeApiKey(key);
    
    await interaction.reply({
        content: result.removed 
            ? '✅ API key removed.'
            : '⚠️ API key not found.',
        ephemeral: true
    });
}

async function handleList(interaction) {
    const config = storage.loadConfig();
    const hofStats = hof.getHOFStats();
    
    let response = '**📊 Activity Tracker Configuration**\n\n';
    
    // Factions
    response += `**Factions:** ${config.factions.length} tracked\n`;
    
    if (config.factions.length > 0 && config.factions.length <= 20) {
        for (const factionId of config.factions) {
            const data = storage.loadFactionData(factionId);
            const hofData = hof.getFactionFromHOF(factionId);
            const name = data?.name || hofData?.name || 'Unknown';
            const rank = hofData?.rank || 'N/A';
            const snapshots = data?.snapshots?.length || 0;
            response += `> • ${name} [${factionId}] - ${rank} - ${snapshots} snapshots\n`;
        }
    } else if (config.factions.length > 20) {
        // Group by rank
        const byRank = {};
        for (const factionId of config.factions) {
            const hofData = hof.getFactionFromHOF(factionId);
            const baseRank = hofData?.rank?.split(' ')[0] || 'Unknown';
            byRank[baseRank] = (byRank[baseRank] || 0) + 1;
        }
        
        for (const [rank, count] of Object.entries(byRank).sort()) {
            response += `> • ${rank}: ${count}\n`;
        }
    }
    
    // API Keys
    response += `\n**API Keys:** ${config.apikeys.length} configured\n`;
    
    // Collection estimate
    const estimate = api.estimateCollectionTime(config.factions.length);
    response += `\n**Collection:**\n`;
    response += `> Rate limit: ${api.RATE_LIMIT_PER_KEY} calls/min/key\n`;
    response += `> Max throughput: ${config.apikeys.length * api.RATE_LIMIT_PER_KEY} calls/min\n`;
    response += `> Est. collection time: ${Math.ceil(estimate / 60)} min\n`;
    
    if (estimate > 14 * 60) {
        const neededKeys = Math.ceil(config.factions.length / (api.RATE_LIMIT_PER_KEY * 14));
        response += `\n⚠️ **Warning:** Need ${neededKeys}+ keys to finish in 15 min!\n`;
    }
    
    // HOF cache
    response += `\n**HOF Cache:**\n`;
    response += `> Total factions: ${hofStats.total}\n`;
    
    if (hofStats.lastUpdated > 0) {
        const age = Math.floor((Date.now() - hofStats.lastUpdated) / (1000 * 60 * 60));
        response += `> Last updated: ${age} hours ago\n`;
    } else {
        response += `> Not yet cached\n`;
    }
    
    await interaction.reply({ content: response, ephemeral: true });
}

async function handleStatus(interaction) {
    const status = collector.getCollectorStatus();
    
    let response = '**🔄 Collector Status**\n\n';
    
    const stateEmoji = status.running ? (status.collecting ? '🟡' : '🟢') : '🔴';
    const stateText = status.running ? (status.collecting ? 'Collecting...' : 'Running') : 'Stopped';
    
    response += `**State:** ${stateEmoji} ${stateText}\n`;
    response += `**Factions:** ${status.factionCount}\n`;
    response += `**API Keys:** ${status.keyCount}\n`;
    response += `**Rate Limit:** ${status.rateLimit} calls/min/key\n`;
    response += `**Est. Collection Time:** ${Math.ceil(status.estimatedCollectionTime / 60)} min\n`;
    
    if (status.lastCollection) {
        const last = status.lastCollection;
        const duration = Math.floor((last.endTime - last.startTime) / 1000);
        const ago = Math.floor((Date.now() - last.endTime) / 1000 / 60);
        
        response += `\n**Last Collection:**\n`;
        response += `> Completed: ${ago} min ago\n`;
        response += `> Success: ${last.success}/${last.success + last.failed}\n`;
        response += `> Duration: ${Math.floor(duration / 60)}m ${duration % 60}s\n`;
    }
    
    response += `\n**API Key Usage (current minute):**\n`;
    for (const [key, info] of Object.entries(status.rateLimitStatus)) {
        const emoji = info.failed ? '❌' : (info.calls >= info.limit ? '🟡' : '🟢');
        response += `> ${emoji} Key ${key}: ${info.calls}/${info.limit} calls\n`;
    }
    
    await interaction.reply({ content: response, ephemeral: true });
}

async function handleCollect(interaction) {
    const status = collector.getCollectorStatus();
    
    if (status.collecting) {
        return await interaction.reply({
            content: '⚠️ Collection already in progress.',
            ephemeral: true
        });
    }
    
    const config = storage.loadConfig();
    const estimate = api.estimateCollectionTime(config.factions.length);
    
    await interaction.reply({
        content: `🔄 Starting manual collection of ${config.factions.length} factions...\n` +
            `⏱️ Estimated time: ${Math.ceil(estimate / 60)} minutes\n\n` +
            `Check console for progress.`,
        ephemeral: true
    });
    
    collector.collectAllFactions();
}

async function handleRefreshHOF(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
        let lastUpdate = '';
        const cache = await hof.updateHOFCache((page, count) => {
            lastUpdate = `📥 Fetching page ${page}... (${count} factions)`;
        });
        
        const stats = hof.getHOFStats();
        
        let response = `✅ **HOF Cache Updated**\n\n`;
        response += `**Total Factions:** ${stats.total}\n\n`;
        response += `**By Rank:**\n`;
        
        for (const [rank, count] of Object.entries(stats.byRank).sort()) {
            response += `> ${rank}: ${count}\n`;
        }
        
        await interaction.editReply({ content: response });
        
    } catch (error) {
        console.error('Refresh HOF error:', error);
        await interaction.editReply({ content: `❌ Error: ${error.message}` });
    }
}