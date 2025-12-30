const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const storage = require('../utils/storage');
const collector = require('../collector');
const api = require('../utils/api');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configure the activity tracker')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add factions or API keys')
                .addStringOption(option =>
                    option
                        .setName('factions')
                        .setDescription('Comma-separated faction IDs')
                )
                .addStringOption(option =>
                    option
                        .setName('apikeys')
                        .setDescription('Comma-separated API keys')
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a faction or API key')
                .addIntegerOption(option =>
                    option
                        .setName('faction')
                        .setDescription('Faction ID to remove')
                )
                .addStringOption(option =>
                    option
                        .setName('apikey')
                        .setDescription('API key to remove')
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
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'add') {
            const factionsInput = interaction.options.getString('factions');
            const apikeysInput = interaction.options.getString('apikeys');
            
            if (!factionsInput && !apikeysInput) {
                return interaction.reply({ 
                    content: '❌ Please provide factions or apikeys to add.', 
                    ephemeral: true 
                });
            }
            
            const config = storage.loadConfig();
            const added = [];
            
            if (factionsInput) {
                const factionIds = factionsInput.split(',')
                    .map(id => parseInt(id.trim()))
                    .filter(id => !isNaN(id) && !config.factions.includes(id));
                
                config.factions.push(...factionIds);
                if (factionIds.length > 0) {
                    added.push(`${factionIds.length} faction(s)`);
                }
            }
            
            if (apikeysInput) {
                const keys = apikeysInput.split(',')
                    .map(k => k.trim())
                    .filter(k => k.length > 0 && !config.apikeys.includes(k));
                
                config.apikeys.push(...keys);
                if (keys.length > 0) {
                    added.push(`${keys.length} API key(s)`);
                }
            }
            
            storage.saveConfig(config);
            
            // Calculate new estimates
            const estimatedTime = api.estimateCollectionTime(config.factions.length);
            const estimatedMin = Math.ceil(estimatedTime / 60);
            
            if (added.length > 0) {
                let response = `✅ Added ${added.join(' and ')}.`;
                response += `\n\n📊 **Current Status:**`;
                response += `\n• Factions: ${config.factions.length}`;
                response += `\n• API Keys: ${config.apikeys.length}`;
                response += `\n• Est. collection time: ${estimatedMin} min`;
                
                if (estimatedTime > 14 * 60) {
                    response += `\n\n⚠️ Warning: Collection may not complete in 15 min interval. Add more API keys.`;
                }
                
                await interaction.reply({ content: response, ephemeral: true });
            } else {
                await interaction.reply({ 
                    content: '⚠️ Nothing new to add (items may already exist).', 
                    ephemeral: true 
                });
            }
            
        } else if (subcommand === 'remove') {
            const factionId = interaction.options.getInteger('faction');
            const apikey = interaction.options.getString('apikey');
            
            if (!factionId && !apikey) {
                return interaction.reply({ 
                    content: '❌ Please provide a faction or apikey to remove.', 
                    ephemeral: true 
                });
            }
            
            const config = storage.loadConfig();
            const removed = [];
            
            if (factionId) {
                const index = config.factions.indexOf(factionId);
                if (index > -1) {
                    config.factions.splice(index, 1);
                    removed.push(`faction ${factionId}`);
                }
            }
            
            if (apikey) {
                const index = config.apikeys.indexOf(apikey);
                if (index > -1) {
                    config.apikeys.splice(index, 1);
                    if (config.currentKeyIndex >= config.apikeys.length) {
                        config.currentKeyIndex = 0;
                    }
                    removed.push('API key');
                }
            }
            
            storage.saveConfig(config);
            
            if (removed.length > 0) {
                await interaction.reply({ 
                    content: `✅ Removed ${removed.join(' and ')}.`, 
                    ephemeral: true 
                });
            } else {
                await interaction.reply({ 
                    content: '⚠️ Item not found.', 
                    ephemeral: true 
                });
            }
            
        } else if (subcommand === 'list') {
            const config = storage.loadConfig();
            const stats = storage.getFactionStats();
            
            let response = '**📊 Activity Tracker Configuration**\n\n';
            
            response += `**Factions:** ${config.factions.length} configured`;
            if (stats.withData !== config.factions.length) {
                response += ` (${stats.withData} with data)`;
            }
            
            if (config.factions.length <= 20) {
                response += '\n';
                for (const factionId of config.factions) {
                    const data = storage.loadFactionData(factionId);
                    const name = data?.name || 'Unknown';
                    const snapshots = data?.snapshots?.length || 0;
                    response += `> • ${name} [${factionId}] - ${snapshots} snapshots\n`;
                }
            } else {
                response += `\n> (Too many to list individually)\n`;
            }
            
            response += `\n**API Keys:** ${config.apikeys.length} configured\n`;
            
            // Show rate limit info
            const estimatedTime = api.estimateCollectionTime(config.factions.length);
            response += `\n**Collection:**\n`;
            response += `> Rate limit: ${api.RATE_LIMIT_PER_KEY} calls/min/key\n`;
            response += `> Max throughput: ${config.apikeys.length * api.RATE_LIMIT_PER_KEY} calls/min\n`;
            response += `> Est. collection time: ${Math.ceil(estimatedTime / 60)} min\n`;
            
            if (estimatedTime > 14 * 60) {
                response += `\n⚠️ **Warning:** Need more API keys to finish in 15 min!\n`;
                const neededKeys = Math.ceil(config.factions.length / (api.RATE_LIMIT_PER_KEY * 14));
                response += `> Recommended: ${neededKeys}+ keys\n`;
            }
            
            await interaction.reply({ content: response, ephemeral: true });
            
        } else if (subcommand === 'status') {
            const status = collector.getCollectorStatus();
            
            let response = '**🔄 Collector Status**\n\n';
            
            response += `**State:** ${status.running ? (status.collecting ? '🟡 Collecting...' : '🟢 Running') : '🔴 Stopped'}\n`;
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
                const status = info.failed ? '❌' : (info.calls >= info.limit ? '🟡' : '🟢');
                response += `> ${status} Key ${key}: ${info.calls}/${info.limit} calls\n`;
            }
            
            await interaction.reply({ content: response, ephemeral: true });
            
        } else if (subcommand === 'collect') {
            const status = collector.getCollectorStatus();
            
            if (status.collecting) {
                return interaction.reply({ 
                    content: '⚠️ Collection already in progress.', 
                    ephemeral: true 
                });
            }
            
            const config = storage.loadConfig();
            const estimatedTime = api.estimateCollectionTime(config.factions.length);
            
            await interaction.reply({ 
                content: `🔄 Starting manual collection of ${config.factions.length} factions...\nEstimated time: ${Math.ceil(estimatedTime / 60)} minutes\n\nCheck console for progress.`,
                ephemeral: true 
            });
            
            collector.collectAllFactions();
        }
    }
};