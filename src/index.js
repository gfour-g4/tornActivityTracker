require('dotenv').config();

const { Client, GatewayIntentBits, Collection, REST, Routes, ActivityType } = require('discord.js');
const collector = require('./collector');
const db = require('./database');
const storage = require('./utils/storage');
const config = require('./config');
const { botLog } = require('./utils/logger');

const activityCommand = require('./commands/activity');
const exportCommand = require('./commands/export');

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds] 
});

client.commands = new Collection();
client.commands.set(activityCommand.data.name, activityCommand);
client.commands.set(exportCommand.data.name, exportCommand);

let presenceInterval = null;

function updatePresence() {
    try {
        const stats = storage.getFactionStats();
        const status = collector.getCollectorStatus();
        
        let activityText;
        if (status.collecting) {
            activityText = `Collecting data...`;
        } else {
            activityText = `${stats.configured} factions | ${stats.totalSnapshots} snapshots`;
        }
        
        client.user.setActivity(activityText, { type: ActivityType.Watching });
    } catch (error) {
        botLog.error({ error: error.message }, 'Failed to update presence');
    }
}

async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    
    const commands = [
        activityCommand.data.toJSON(),
        exportCommand.data.toJSON()
    ];
    
    try {
        botLog.info('Registering slash commands...');
        
        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: commands }
        );
        
        botLog.info('Slash commands registered successfully');
    } catch (error) {
        botLog.error({ error: error.message }, 'Error registering commands');
    }
}

client.once('ready', async () => {
    botLog.info({ tag: client.user.tag }, 'Bot logged in');
    
    // Initialize database
    db.getDb();
    
    await registerCommands();
    
    collector.startCollector();
    
    // Set initial presence
    updatePresence();
    
    // Update presence periodically
    presenceInterval = setInterval(updatePresence, config.presence.updateIntervalMs);
});

client.on('interactionCreate', async interaction => {
    if (interaction.isAutocomplete()) {
        const command = client.commands.get(interaction.commandName);
        
        if (!command || !command.autocomplete) return;
        
        try {
            await command.autocomplete(interaction);
        } catch (error) {
            botLog.error({ error: error.message }, 'Autocomplete error');
        }
        return;
    }
    
    if (!interaction.isChatInputCommand()) return;
    
    const command = client.commands.get(interaction.commandName);
    
    if (!command) return;
    
    try {
        await command.execute(interaction);
    } catch (error) {
        botLog.error({ 
            error: error.message, 
            command: interaction.commandName,
            user: interaction.user.tag 
        }, 'Command execution error');
        
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

function shutdown() {
    botLog.info('Shutting down...');
    
    if (presenceInterval) {
        clearInterval(presenceInterval);
    }
    
    collector.stopCollector();
    db.closeDb();
    client.destroy();
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

client.login(process.env.DISCORD_TOKEN);
