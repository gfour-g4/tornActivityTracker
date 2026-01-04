const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all available commands and how to use them')
        .addStringOption(option =>
            option
                .setName('command')
                .setDescription('Get detailed help for a specific command')
                .addChoices(
                    { name: 'Heatmaps', value: 'heatmaps' },
                    { name: 'Leaderboard', value: 'leaderboard' },
                    { name: 'Export', value: 'export' },
                    { name: 'Management', value: 'management' },
                    { name: 'Status', value: 'status' }
                )
        ),

    async execute(interaction) {
        const topic = interaction.options.getString('command');
        
        if (topic) {
            return await sendDetailedHelp(interaction, topic);
        }
        
        const embed = new EmbedBuilder()
            .setColor(0x8B5CF6)
            .setTitle('📊 Torn Activity Tracker')
            .setDescription('Track and analyze faction member activity patterns.')
            .addFields(
                {
                    name: '🗺️ Heatmaps',
                    value: [
                        '`/activity faction <name>` - Faction activity heatmap',
                        '`/activity user <name>` - User activity heatmap',
                        '`/activity compare <f1> <f2>` - Compare two factions'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '🏆 Leaderboard',
                    value: '`/activity leaderboard <faction>` - Top active members',
                    inline: false
                },
                {
                    name: '📤 Export',
                    value: [
                        '`/export faction <name>` - Export faction report (HTML)',
                        '`/export member <name>` - Export member report (HTML)'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '⚙️ Management (Admin)',
                    value: [
                        '`/activity add-factions <ids>` - Add factions to track',
                        '`/activity add-rank <rank>` - Add all factions of a rank',
                        '`/activity add-key <key>` - Add API key',
                        '`/activity remove-factions <ids>` - Remove factions',
                        '`/activity remove-key <key>` - Remove API key'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '📈 Status',
                    value: [
                        '`/activity list` - Show configuration',
                        '`/activity status` - Collector status & rate limits',
                        '`/activity collect` - Trigger manual collection',
                        '`/activity refresh-hof` - Refresh Hall of Fame cache'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '💡 Tips',
                    value: 'Use `/help <topic>` for detailed help on each category.',
                    inline: false
                }
            )
            .setFooter({ text: 'Data collected every 15 minutes • Times shown in UTC' });
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};

async function sendDetailedHelp(interaction, topic) {
    let embed;
    
    switch (topic) {
        case 'heatmaps':
            embed = new EmbedBuilder()
                .setColor(0x8B5CF6)
                .setTitle('🗺️ Heatmap Commands')
                .setDescription('Visualize activity patterns with color-coded heatmaps.')
                .addFields(
                    {
                        name: '/activity faction',
                        value: [
                            '**Usage:** `/activity faction <name> [granularity] [days]`',
                            '',
                            '**Options:**',
                            '• `faction` - Faction name or ID (required)',
                            '• `granularity` - `hourly` or `15min` (default: hourly)',
                            '• `days` - Filter days: `all`, `weekday`, `weekend`, or `mon,tue,wed`',
                            '',
                            '**Examples:**',
                            '`/activity faction Sicarius`',
                            '`/activity faction 8677 granularity:15min`',
                            '`/activity faction Sicarius days:weekend`'
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '/activity user',
                        value: [
                            '**Usage:** `/activity user <name> [granularity] [days]`',
                            '',
                            'Shows what % of the time a user is active at each hour.',
                            'Tracks across all factions the user has been seen in.',
                            '',
                            '**Example:**',
                            '`/activity user Duke granularity:15min`'
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '/activity compare',
                        value: [
                            '**Usage:** `/activity compare <faction1> <faction2> [granularity] [days]`',
                            '',
                            'Generates two images:',
                            '• Side-by-side comparison',
                            '• Difference heatmap (green = faction1 higher)',
                            '',
                            '**Example:**',
                            '`/activity compare Sicarius "Other Faction" days:weekday`'
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: 'How to Read',
                        value: [
                            '**Faction heatmap:** Average unique members active per hour',
                            '**User heatmap:** % of occurrences the user was active',
                            '',
                            '🟢 Green = High activity',
                            '🟡 Yellow = Medium activity',
                            '🔴 Red = Low activity'
                        ].join('\n'),
                        inline: false
                    }
                );
            break;
            
        case 'leaderboard':
            embed = new EmbedBuilder()
                .setColor(0x8B5CF6)
                .setTitle('🏆 Leaderboard Command')
                .setDescription('See the most active faction members.')
                .addFields(
                    {
                        name: 'Usage',
                        value: '`/activity leaderboard <faction> [period]`',
                        inline: false
                    },
                    {
                        name: 'Options',
                        value: [
                            '• `faction` - Faction name or ID (required)',
                            '• `period` - `7`, `14`, or `30` days (default: 7)'
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: 'How It Works',
                        value: [
                            'Shows top 15 members by activity percentage.',
                            '',
                            'Activity % = (times seen active / total snapshots) × 100',
                            '',
                            '🟢 70%+ = Very active',
                            '🟡 40-69% = Moderately active',
                            '🔴 <40% = Low activity'
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: 'Example',
                        value: '`/activity leaderboard Sicarius period:30`',
                        inline: false
                    }
                );
            break;
            
        case 'export':
            embed = new EmbedBuilder()
                .setColor(0x8B5CF6)
                .setTitle('📤 Export Commands')
                .setDescription('Export detailed activity reports as HTML files.')
                .addFields(
                    {
                        name: '/export faction',
                        value: [
                            '**Usage:** `/export faction <name>`',
                            '',
                            'Generates an interactive HTML report with:',
                            '• Activity heatmap (hourly & 15-min toggle)',
                            '• Member list with activity scores',
                            '• Search/filter members',
                            '',
                            '**Example:** `/export faction Sicarius`'
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '/export member',
                        value: [
                            '**Usage:** `/export member <name>`',
                            '',
                            'Generates a personal activity report with:',
                            '• Activity heatmap',
                            '• 7-day and 30-day activity stats',
                            '• Links to Torn profile',
                            '',
                            '**Example:** `/export member Duke`'
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: 'Tip',
                        value: 'Open the HTML file in any browser. Works offline!',
                        inline: false
                    }
                );
            break;
            
        case 'management':
            embed = new EmbedBuilder()
                .setColor(0x8B5CF6)
                .setTitle('⚙️ Management Commands')
                .setDescription('Admin-only commands to configure tracking.')
                .addFields(
                    {
                        name: 'Adding Factions',
                        value: [
                            '`/activity add-factions <factions>`',
                            'Add by name or ID, comma-separated.',
                            'Example: `/activity add-factions Sicarius, 8677, 12345`',
                            '',
                            '`/activity add-rank <rank> [min-members] [max-members]`',
                            'Add all Diamond or Platinum factions.',
                            'Example: `/activity add-rank platinum min-members:50`'
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: 'Removing Factions',
                        value: [
                            '`/activity remove-factions <factions>`',
                            '`/activity remove-rank <rank> [min-members] [max-members]`'
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: 'API Keys',
                        value: [
                            '`/activity add-key <key> [rate-limit]`',
                            'Add a Torn API key. Rate limit defaults to 20/min.',
                            'Example: `/activity add-key abc123 rate-limit:15`',
                            '',
                            '`/activity remove-key <key>`',
                            'Remove an API key.'
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '⚠️ Rate Limits',
                        value: [
                            'Each API key can make ~20 calls/minute.',
                            'You need enough keys to collect all factions in 15 min.',
                            '',
                            'Formula: `factions ÷ 20 ÷ 14 = keys needed`',
                            'Example: 100 factions ÷ 20 ÷ 14 = ~1 key'
                        ].join('\n'),
                        inline: false
                    }
                );
            break;
            
        case 'status':
            embed = new EmbedBuilder()
                .setColor(0x8B5CF6)
                .setTitle('📈 Status Commands')
                .setDescription('Monitor the bot and data collection.')
                .addFields(
                    {
                        name: '/activity list',
                        value: [
                            'Shows current configuration:',
                            '• Tracked factions (with ranks)',
                            '• API keys and their rate limits',
                            '• Estimated collection time',
                            '• HOF cache status'
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '/activity status',
                        value: [
                            'Shows live collector status:',
                            '• Running/collecting state',
                            '• Last collection stats',
                            '• Per-key API usage',
                            '• Next scheduled collection'
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '/activity collect',
                        value: 'Manually trigger data collection (admin only).',
                        inline: false
                    },
                    {
                        name: '/activity refresh-hof',
                        value: [
                            'Refresh the Hall of Fame cache (admin only).',
                            'Normally updates automatically every 7 days.'
                        ].join('\n'),
                        inline: false
                    }
                );
            break;
            
        default:
            embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Unknown Topic')
                .setDescription('Use `/help` to see all available topics.');
    }
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
}