const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { generateFactionHTML, generateMemberHTML } = require('../export/generator');
const storage = require('../utils/storage');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('export')
        .setDescription('Export activity data as HTML file')
        .addSubcommand(subcommand =>
            subcommand
                .setName('faction')
                .setDescription('Export faction activity report')
                .addStringOption(option =>
                    option
                        .setName('faction')
                        .setDescription('Faction name or ID')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('member')
                .setDescription('Export member activity report')
                .addStringOption(option =>
                    option
                        .setName('member')
                        .setDescription('Member name or ID')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
        ),

    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);
        const value = focusedOption.value;
        
        let choices = [];
        
        if (focusedOption.name === 'member') {
            if (value.length === 0) {
                choices = storage.getAllMemberChoices();
            } else {
                choices = storage.searchMemberByName(value).map(m => ({
                    name: `${m.name} [${m.id}]`,
                    value: m.id.toString()
                }));
            }
        } else {
            // faction
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
        
        await interaction.deferReply();

        try {
            let html, filename;
            
            if (subcommand === 'faction') {
                const input = interaction.options.getString('faction');
                const faction = storage.resolveFaction(input);
                
                if (!faction) {
                    return await interaction.editReply({
                        content: `❌ Faction not found: "${input}"\nUse a faction name or ID from the tracked list.`
                    });
                }
                
                html = await generateFactionHTML(faction.id);
                filename = `${sanitizeFilename(faction.name)}_activity.html`;
                
            } else if (subcommand === 'member') {
                const input = interaction.options.getString('member');
                const member = storage.resolveMember(input);
                
                if (!member) {
                    return await interaction.editReply({
                        content: `❌ Member not found: "${input}"\nThe member must have been active in a tracked faction.`
                    });
                }
                
                html = await generateMemberHTML(member.id);
                filename = `${sanitizeFilename(member.name)}_activity.html`;
            }
            
            const buffer = Buffer.from(html, 'utf-8');
            const attachment = new AttachmentBuilder(buffer, { name: filename });
            
            await interaction.editReply({
                content: '📊 Here\'s your activity report! Open the HTML file in any browser.',
                files: [attachment]
            });
            
        } catch (error) {
            console.error('Export error:', error);
            await interaction.editReply({
                content: `❌ Error: ${error.message}`
            });
        }
    }
};

function sanitizeFilename(name) {
    return name
        .replace(/[^a-zA-Z0-9_\-]/g, '_')
        .replace(/_+/g, '_')
        .substring(0, 50);
}