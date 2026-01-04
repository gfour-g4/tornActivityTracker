
const { SlashCommandBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const heatmap = require('../heatmap');
const storage = require('../utils/storage');
const hof = require('../utils/hof');
const api = require('../utils/api');
const collector = require('../collector');
const db = require('../database');
const { resolveMultipleFactions } = require('../utils/helpers');
const { cmdLog } = require('../utils/logger');

const GRANULARITY_CHOICES = [
    { name: 'Hourly', value: 'hourly' },
    { name: '15 Minutes', value: '15min' }
];

const RANK_CHOICES = [
    { name: 'Platinum', value: 'platinum' },
    { name: 'Diamond', value: 'diamond' }
];

const LEADERBOARD_PERIOD_CHOICES = [
    { name: '7 Days', value: '7' },
    { name: '14 Days', value: '14' },
    { name: '30 Days', value: '30' }
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
        // Leaderboard subcommand
        .addSubcommand(subcommand =>
            subcommand
                .setName('leaderboard')
                .setDescription('View faction member activity leaderboard')
                .addStringOption(option =>
                    option
                        .setName('faction')
                        .setDescription('Faction name or ID')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addStringOption(option =>
                    option
                        .setName('period')
                        .setDescription('Time period')
                        .addChoices(...LEADERBOARD_PERIOD_CHOICES)
                )
        )
        // Management subcommands
        .addSubcommand(subcommand =>
            subcommand
                .setName('add-factions')
                .setDescription('Add factions to track')
                .addStringOption(option =>
                    option
                        .setName('factions')
                        .setDescription('Faction names or IDs (comma-separated)')
                        .setRequired(true)
                        .setAutocomplete(true)
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
                        .setName('min-members')
                        .setDescription('Minimum member count')
                        .setMinValue(1)
                        .setMaxValue(100)
                )
                .addIntegerOption(option =>
                    option
                        .setName('max-members')
                        .setDescription('Maximum member count')
                        .setMinValue(1)
                        .setMaxValue(100)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('add-key')
                .setDescription('Add an API key')
                .addStringOption(option =>
                    option
                        .setName('key')
                        .setDescription('API key')
                        .setRequired(true)
                )
                .addIntegerOption(option =>
                    option
                        .setName('rate-limit')
                        .setDescription('Max calls per minute (default: 20, max: 20)')
                        .setMinValue(1)
                        .setMaxValue(20)
                )
        )        
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove-factions')
                .setDescription('Remove factions from tracking')
                .addStringOption(option =>
                    option
                        .setName('factions')
                        .setDescription('Faction names or IDs (comma-separated)')
                        .setRequired(true)
                        .setAutocomplete(true)
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
                .addIntegerOption(option =>
                    option
                        .setName('min-members')
                        .setDescription('Minimum member count')
                        .setMinValue(1)
                        .setMaxValue(100)
                )
                .addIntegerOption(option =>
                    option
                        .setName('max-members')
                        .setDescription('Maximum member count')
                        .setMinValue(1)
                        .setMaxValue(100)
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
        } else if (focusedOption.name === 'factions') {
            const parts = value.split(',');
            const current = parts[parts.length - 1].trim();
            const prefix = parts.slice(0, -1).join(',');
            
            if (current.length === 0) {
                const hofFactions = hof.loadHOFCache().factions.slice(0, 25);
                choices = hofFactions.map(f => ({
                    name: `${f.name} [${f.id}]`,
                    value: prefix ? `${prefix},${f.id}` : f.id.toString()
                }));
            } else {
                const hofResults = hof.searchHOFByName(current);
                const trackedResults = storage.searchFactionByName(current);
                
                const seen = new Set();
                const merged = [];
                
                for (const f of [...trackedResults, ...hofResults]) {
                    if (!seen.has(f.id)) {
                        merged.push(f);
                        seen.add(f.id);
                    }
                }
                
                choices = merged.slice(0, 25).map(f => ({
                    name: `${f.name} [${f.id}]`,
                    value: prefix ? `${prefix},${f.id}` : f.id.toString()
                }));
            }
        } else if (['faction', 'faction1', 'faction2'].includes(focusedOption.name)) {
            if (value.length === 0) {
                choices = storage.getAllFactionChoices();
            } else {
                const tracked = storage.searchFactionByName(value);
                const hofResults = hof.searchHOFByName(value);
                
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
        
        if (subcommand === 'leaderboard') {
            return await handleLeaderboard(interaction);
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
        
        if (subcommand === 'add-key') {
            return await handleAddKey(interaction);
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
        cmdLog.error({ error: error.message, input }, 'Faction heatmap error');
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
        cmdLog.error({ error: error.message, input }, 'User heatmap error');
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
        cmdLog.error({ error: error.message }, 'Compare error');
        await interaction.editReply({ content: `❌ Error: ${error.message}` });
    }
}

// ============================================
// LEADERBOARD HANDLER
// ============================================

async function handleLeaderboard(interaction) {
    const input = interaction.options.getString('faction');
    const period = parseInt(interaction.options.getString('period') || '7');
    
    await interaction.deferReply();
    
    try {
        const faction = storage.resolveFaction(input);
        
        if (!faction) {
            return await interaction.editReply({
                content: `❌ Faction not found: "${input}"\nUse a faction name or ID from the tracked list.`
            });
        }
        
        const leaderboard = db.getMemberLeaderboard(faction.id, period, 15);
        
        if (leaderboard.length === 0) {
            return await interaction.editReply({
                content: `❌ No activity data found for **${faction.name}** in the last ${period} days.`
            });
        }
        
        const totalSnapshots = leaderboard[0]?.total_snapshots || 0;
        const lastUpdated = db.getFactionLastUpdated(faction.id);
        
        const imageBuffer = heatmap.generateLeaderboardImage(
            faction.name,
            faction.id,
            leaderboard,
            period,
            totalSnapshots,
            lastUpdated
        );
        
        const attachment = new AttachmentBuilder(imageBuffer, { 
            name: `leaderboard_${faction.id}.png` 
        });
        
        await interaction.editReply({ files: [attachment] });
        
    } catch (error) {
        cmdLog.error({ error: error.message, input }, 'Leaderboard error');
        await interaction.editReply({ content: `❌ Error: ${error.message}` });
    }
}

// ============================================
// MANAGEMENT HANDLERS
// ============================================

async function handleAddFactions(interaction) {
    const input = interaction.options.getString('factions');
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
        const resolved = resolveMultipleFactions(input, hof, storage);
        
        if (resolved.length === 0) {
            return await interaction.editReply({
                content: '❌ No valid factions found. Use faction names or IDs.'
            });
        }
        
        const ids = resolved.map(f => f.id);
        const result = storage.addFactionsByIds(ids);
        
        let response = `✅ Added **${result.added}** faction(s)`;
        
        if (result.skipped > 0) {
            response += ` (${result.skipped} already tracked)`;
        }
        
        if (result.added > 0 && resolved.length <= 10) {
            response += '\n\n**Added:**\n' + resolved
                .slice(0, result.added)
                .map(f => `• ${f.name} [${f.id}]${f.members ? ` - ${f.members} members` : ''}`)
                .join('\n');
        }
        
        const config = storage.loadConfig();
        const estimate = api.estimateCollectionTime(config.factions.length);
        response += `\n\n📈 Now tracking **${config.factions.length}** factions`;
        response += `\n⏱️ Est. collection time: **${Math.ceil(estimate / 60)}** minutes`;
        
        if (estimate > 14 * 60) {
            response += `\n⚠️ Warning: Collection may not complete in 15 min. Add more API keys.`;
        }
        
        cmdLog.info({ added: result.added, skipped: result.skipped }, 'Factions added');
        await interaction.editReply({ content: response });
        
    } catch (error) {
        cmdLog.error({ error: error.message }, 'Add factions error');
        await interaction.editReply({ content: `❌ Error: ${error.message}` });
    }
}

async function handleAddRank(interaction) {
    const rank = interaction.options.getString('rank');
    const minMembers = interaction.options.getInteger('min-members');
    const maxMembers = interaction.options.getInteger('max-members');
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
        await hof.ensureHOFCache();
        
        const result = storage.addFactionsByRank(rank, minMembers, maxMembers);
        
        let response = `✅ Added **${result.added}** ${rank} faction(s)`;
        
        if (result.skipped > 0) {
            response += ` (${result.skipped} already tracked)`;
        }
        
        const filters = [];
        if (minMembers) filters.push(`min ${minMembers}`);
        if (maxMembers) filters.push(`max ${maxMembers}`);
        if (filters.length > 0) {
            response += `\n📊 Filter: ${filters.join(', ')} members`;
        }
        
        if (result.added > 0 && result.added <= 10) {
            response += '\n\n**Added:**\n' + result.factions.map(f => 
                `• ${f.name} [${f.id}] - ${f.members} members`
            ).join('\n');
        }
        
        const config = storage.loadConfig();
        const estimate = api.estimateCollectionTime(config.factions.length);
        response += `\n\n📈 Now tracking **${config.factions.length}** factions`;
        response += `\n⏱️ Est. collection time: **${Math.ceil(estimate / 60)}** minutes`;
        
        if (estimate > 14 * 60) {
            response += `\n⚠️ Warning: Collection may not complete in 15 min. Add more API keys.`;
        }
        
        cmdLog.info({ rank, added: result.added, skipped: result.skipped }, 'Rank factions added');
        await interaction.editReply({ content: response });
        
    } catch (error) {
        cmdLog.error({ error: error.message }, 'Add rank error');
        await interaction.editReply({ content: `❌ Error: ${error.message}` });
    }
}

async function handleAddKey(interaction) {
    const key = interaction.options.getString('key');
    const rateLimit = interaction.options.getInteger('rate-limit');
    
    const result = storage.addApiKey(key, rateLimit);
    
    if (result.added) {
        cmdLog.info({ rateLimit: result.rateLimit }, 'API key added');
        
        await interaction.reply({
            content: `✅ API key added with rate limit: **${result.rateLimit}** calls/min`,
            ephemeral: true
        });
    } else {
        await interaction.reply({
            content: `❌ ${result.reason}`,
            ephemeral: true
        });
    }
}

async function handleRemoveFactions(interaction) {
    const input = interaction.options.getString('factions');
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
        const resolved = resolveMultipleFactions(input, hof, storage);
        
        if (resolved.length === 0) {
            return await interaction.editReply({
                content: '❌ No valid factions found. Use faction names or IDs.'
            });
        }
        
        const ids = resolved.map(f => f.id);
        const result = storage.removeFactionsByIds(ids);
        
        let response = result.removed > 0
            ? `✅ Removed **${result.removed}** faction(s)`
            : '⚠️ No matching factions found to remove.';
        
        if (result.removed > 0 && resolved.length <= 10) {
            response += '\n\n**Removed:**\n' + resolved
                .slice(0, result.removed)
                .map(f => `• ${f.name} [${f.id}]${f.members ? ` - ${f.members} members` : ''}`)
                .join('\n');
        }
        
        const config = storage.loadConfig();
        response += `\n\n📈 Now tracking **${config.factions.length}** factions`;
        
        cmdLog.info({ removed: result.removed }, 'Factions removed');
        await interaction.editReply({ content: response });
        
    } catch (error) {
        cmdLog.error({ error: error.message }, 'Remove factions error');
        await interaction.editReply({ content: `❌ Error: ${error.message}` });
    }
}

async function handleRemoveRank(interaction) {
    const rank = interaction.options.getString('rank');
    const minMembers = interaction.options.getInteger('min-members');
    const maxMembers = interaction.options.getInteger('max-members');
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
        await hof.ensureHOFCache();
        
        const result = storage.removeFactionsByRank(rank, minMembers, maxMembers);
        
        let response = result.removed > 0
            ? `✅ Removed **${result.removed}** ${rank} faction(s)`
            : `⚠️ No matching ${rank} factions were being tracked.`;
        
        const filters = [];
        if (minMembers) filters.push(`min ${minMembers}`);
        if (maxMembers) filters.push(`max ${maxMembers}`);
        if (filters.length > 0) {
            response += `\n📊 Filter: ${filters.join(', ')} members`;
        }
        
        if (result.removed > 0 && result.removed <= 10) {
            response += '\n\n**Removed:**\n' + result.factions.map(f => 
                `• ${f.name} [${f.id}] - ${f.members} members`
            ).join('\n');
        }
        
        const config = storage.loadConfig();
        response += `\n\n📈 Now tracking **${config.factions.length}** factions`;
        
        cmdLog.info({ rank, removed: result.removed }, 'Rank factions removed');
        await interaction.editReply({ content: response });
        
    } catch (error) {
        cmdLog.error({ error: error.message }, 'Remove rank error');
        await interaction.editReply({ content: `❌ Error: ${error.message}` });
    }
}

async function handleRemoveKey(interaction) {
    const key = interaction.options.getString('key');
    
    const result = storage.removeApiKey(key);
    
    if (result.removed) {
        cmdLog.info('API key removed');
    }
    
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
    
    // Factions section (unchanged)
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
    
    // API Keys section - show rate limits
    response += `\n**API Keys:** ${config.apikeys.length} configured\n`;
    
    for (const entry of config.apikeys) {
        const masked = `...${entry.key.slice(-4)}`;
        response += `> • Key ${masked}: ${entry.rateLimit} calls/min\n`;
    }
    
    // Calculate totals
    const totalRateLimit = config.apikeys.reduce((sum, e) => sum + e.rateLimit, 0);
    const estimate = api.estimateCollectionTime(config.factions.length);
    
    response += `\n**Collection:**\n`;
    response += `> Total throughput: ${totalRateLimit} calls/min\n`;
    response += `> Est. collection time: ${Math.ceil(estimate / 60)} min\n`;
    
    if (estimate > 14 * 60) {
        const currentThroughput = totalRateLimit;
        const neededThroughput = Math.ceil(config.factions.length / 14);
        response += `\n⚠️ **Warning:** Need ${neededThroughput} calls/min to finish in 15 min! (Currently: ${currentThroughput})\n`;
    }
    
    // HOF cache section (unchanged)
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

// Update handleStatus to show per-key limits
async function handleStatus(interaction) {
    const status = collector.getCollectorStatus();
    
    let response = '**🔄 Collector Status**\n\n';
    
    const stateEmoji = status.running ? (status.collecting ? '🟡' : '🟢') : '🔴';
    const stateText = status.running ? (status.collecting ? 'Collecting...' : 'Running') : 'Stopped';
    
    response += `**State:** ${stateEmoji} ${stateText}\n`;
    response += `**Factions:** ${status.factionCount}\n`;
    response += `**API Keys:** ${status.keyCount}\n`;
    response += `**Est. Collection Time:** ${Math.ceil(status.estimatedCollectionTime / 60)} min\n`;
    response += `**Next Slot:** ${status.nextSlot}\n`;
    
    if (status.lastCollection) {
        const last = status.lastCollection;
        const duration = Math.floor((last.endTime - last.startTime) / 1000);
        const ago = Math.floor((Date.now() - last.endTime) / 1000 / 60);
        
        response += `\n**Last Collection:**\n`;
        response += `> Completed: ${ago} min ago\n`;
        response += `> Success: ${last.success}/${last.success + last.failed}\n`;
        if (last.skipped > 0) {
            response += `> Skipped: ${last.skipped} (already collected)\n`;
        }
        response += `> Duration: ${Math.floor(duration / 60)}m ${duration % 60}s\n`;
    }
    
    response += `\n**API Key Usage (current minute):**\n`;
    for (const [key, info] of Object.entries(status.rateLimitStatus)) {
        const emoji = info.failed ? '❌' : (info.calls >= info.limit ? '🟡' : '🟢');
        response += `> ${emoji} Key ${key}: ${info.calls}/${info.limit} calls\n`;
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
    
    cmdLog.info({ factions: config.factions.length }, 'Manual collection triggered');
    
    await interaction.reply({
        content: `🔄 Starting manual collection of ${config.factions.length} factions...\n` +
            `⏱️ Estimated time: ${Math.ceil(estimate / 60)} minutes\n\n` +
            `Check logs for progress.`,
        ephemeral: true
    });
    
    collector.collectAllFactions();
}

async function handleRefreshHOF(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
        cmdLog.info('Manual HOF refresh triggered');
        
        await hof.updateHOFCache();
        
        const stats = hof.getHOFStats();
        
        let response = `✅ **HOF Cache Updated**\n\n`;
        response += `**Total Factions:** ${stats.total}\n\n`;
        response += `**By Rank:**\n`;
        
        for (const [rank, count] of Object.entries(stats.byRank).sort()) {
            response += `> ${rank}: ${count}\n`;
        }
        
        await interaction.editReply({ content: response });
        
    } catch (error) {
        cmdLog.error({ error: error.message }, 'Refresh HOF error');
        await interaction.editReply({ content: `❌ Error: ${error.message}` });
    }
}