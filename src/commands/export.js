const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { generateFactionHTML, generateMemberHTML } = require('../export/generator');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('export')
        .setDescription('Export activity data as HTML file')
        .addSubcommand(subcommand =>
            subcommand
                .setName('faction')
                .setDescription('Export faction activity report')
                .addIntegerOption(option =>
                    option
                        .setName('id')
                        .setDescription('Faction ID')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('member')
                .setDescription('Export member activity report')
                .addIntegerOption(option =>
                    option
                        .setName('id')
                        .setDescription('Member ID')
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        
        await interaction.deferReply();

        try {
            let html, filename;
            
            if (subcommand === 'faction') {
                const factionId = interaction.options.getInteger('id');
                html = await generateFactionHTML(factionId);
                filename = `faction_${factionId}_activity.html`;
            } else if (subcommand === 'member') {
                const memberId = interaction.options.getInteger('id');
                html = await generateMemberHTML(memberId);
                filename = `member_${memberId}_activity.html`;
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