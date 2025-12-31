const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const heatmap = require('../heatmap');
const storage = require('../utils/storage');

const GRANULARITY_CHOICES = [
    { name: 'Hourly', value: 'hourly' },
    { name: '15 Minutes', value: '15min' }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('activity')
        .setDescription('View activity heatmaps')
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
                        .setDescription('Days to include (all, weekday, weekend, or comma-separated: mon,tue,wed)')
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
                        .setDescription('Days to include (all, weekday, weekend, or comma-separated)')
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
                        .setDescription('Days to include (all, weekday, weekend, or comma-separated)')
                )
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
        } else {
            // faction, faction1, faction2
            if (value.length === 0) {
                choices = storage.getAllFactionChoices();
            } else {
                choices = storage.searchFactionByName(value).map(f => ({
                    name: `${f.name} [${f.id}]`,
                    value: f.id.toString()
                }));
            }
        }
        
        await interaction.respond(choices.slice(0, 25));
    },

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const granularity = interaction.options.getString('granularity') || 'hourly';
        const days = interaction.options.getString('days') || 'all';

        await interaction.deferReply();

        try {
            if (subcommand === 'faction') {
                const input = interaction.options.getString('faction');
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
                
            } else if (subcommand === 'user') {
                const input = interaction.options.getString('user');
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
                
            } else if (subcommand === 'compare') {
                const input1 = interaction.options.getString('faction1');
                const input2 = interaction.options.getString('faction2');
                
                const faction1 = storage.resolveFaction(input1);
                const faction2 = storage.resolveFaction(input2);
                
                if (!faction1) {
                    return await interaction.editReply({
                        content: `❌ First faction not found: "${input1}"`
                    });
                }
                
                if (!faction2) {
                    return await interaction.editReply({
                        content: `❌ Second faction not found: "${input2}"`
                    });
                }
                
                const { sideBySide, difference } = await heatmap.createComparisonHeatmaps(
                    faction1.id, faction2.id, granularity, days
                );
                
                const attachment1 = new AttachmentBuilder(sideBySide, { 
                    name: 'comparison_side_by_side.png' 
                });
                const attachment2 = new AttachmentBuilder(difference, { 
                    name: 'comparison_difference.png' 
                });
                
                await interaction.editReply({ 
                    content: `**${faction1.name}** vs **${faction2.name}**`,
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