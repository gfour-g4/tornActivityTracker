require('dotenv').config();

const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const collector = require('./collector');
const db = require('./database');

const activityCommand = require('./commands/activity');
const exportCommand = require('./commands/export');

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds] 
});

client.commands = new Collection();
client.commands.set(activityCommand.data.name, activityCommand);
client.commands.set(exportCommand.data.name, exportCommand);

async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    
    const commands = [
        activityCommand.data.toJSON(),
        exportCommand.data.toJSON()
    ];
    
    try {
        console.log('Registering slash commands...');
        
        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: commands }
        );
        
        console.log('Slash commands registered successfully.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    
    // Initialize database
    db.getDb();
    
    await registerCommands();
    
    collector.startCollector();
});

client.on('interactionCreate', async interaction => {
    if (interaction.isAutocomplete()) {
        const command = client.commands.get(interaction.commandName);
        
        if (!command || !command.autocomplete) return;
        
        try {
            await command.autocomplete(interaction);
        } catch (error) {
            console.error('Autocomplete error:', error);
        }
        return;
    }
    
    if (!interaction.isChatInputCommand()) return;
    
    const command = client.commands.get(interaction.commandName);
    
    if (!command) return;
    
    try {
        await command.execute(interaction);
    } catch (error) {
        console.error('Command execution error:', error);
        
        const errorMessage = { 
            content: '❌ An error occurred while executing this command.', 
            ephemeral: true 
        };
        
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMessage);
        } else {
            await interaction.reply(errorMessage);
        }
    }
});

process.on('SIGINT', () => {
    console.log('Shutting down...');
    collector.stopCollector();
    db.closeDb();
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('Shutting down...');
    collector.stopCollector();
    db.closeDb();
    client.destroy();
    process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);