const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const heatmap = require('../heatmap');

const GRANULARITY_CHOICES = [
    { name: 'Hourly', value: 'hourly' },
    { name: '15 Minutes', value: '15min' }
];

const DAYS_CHOICES = [
    { name: 'All Days', value: 'all' },
    { name: 'Weekdays (Mon-Fri)', value: 'weekday' },
    { name: 'Weekend (Sat-Sun)', value: 'weekend' }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('activity')
        .setDescription('View activity heatmaps')
        .addSubcommand(subcommand =>
            subcommand
                .setName('faction')
                .setDescription('View faction activity heatmap')
                .addIntegerOption(option =>
                    option
                        .setName('id')
                        .setDescription('Faction ID')
                        .setRequired(true)
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
                        .setDescription('Days to include (all, weekday, weekend, or comma-separated: mon,tue,wed)')
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('user')
                .setDescription('View user activity heatmap')
                .addIntegerOption(option =>
                    option
                        .setName('id')
                        .setDescription('User ID')
                        .setRequired(true)
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
                        .setDescription('Days to include (all, weekday, weekend, or comma-separated)')
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('compare')
                .setDescription('Compare two factions')
                .addIntegerOption(option =>
                    option
                        .setName('faction1')
                        .setDescription('First faction ID')
                        .setRequired(true)
                )
                .addIntegerOption(option =>
                    option
                        .setName('faction2')
                        .setDescription('Second faction ID')
                        .setRequired(true)
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
                        .setDescription('Days to include (all, weekday, weekend, or comma-separated)')
                )
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const granularity = interaction.options.getString('granularity') || 'hourly';
        const days = interaction.options.getString('days') || 'all';

        await interaction.deferReply();

        try {
            if (subcommand === 'faction') {
                const factionId = interaction.options.getInteger('id');
                const imageBuffer = await heatmap.createFactionHeatmap(factionId, granularity, days);
                
                const attachment = new AttachmentBuilder(imageBuffer, { 
                    name: `faction_${factionId}_activity.png` 
                });
                
                await interaction.editReply({ files: [attachment] });
                
            } else if (subcommand === 'user') {
                const userId = interaction.options.getInteger('id');
                const imageBuffer = await heatmap.createUserHeatmap(userId, granularity, days);
                
                const attachment = new AttachmentBuilder(imageBuffer, { 
                    name: `user_${userId}_activity.png` 
                });
                
                await interaction.editReply({ files: [attachment] });
                
            } else if (subcommand === 'compare') {
                const faction1Id = interaction.options.getInteger('faction1');
                const faction2Id = interaction.options.getInteger('faction2');
                
                const { sideBySide, difference } = await heatmap.createComparisonHeatmaps(
                    faction1Id, faction2Id, granularity, days
                );
                
                const attachment1 = new AttachmentBuilder(sideBySide, { 
                    name: 'comparison_side_by_side.png' 
                });
                const attachment2 = new AttachmentBuilder(difference, { 
                    name: 'comparison_difference.png' 
                });
                
                await interaction.editReply({ 
                    content: '**Side-by-side comparison:**',
                    files: [attachment1] 
                });
                
                await interaction.followUp({ 
                    content: '**Difference heatmap:**',
                    files: [attachment2] 
                });
            }
        } catch (error) {
            console.error('Activity command error:', error);
            await interaction.editReply({ 
                content: `❌ Error: ${error.message}` 
            });
        }
    }
};