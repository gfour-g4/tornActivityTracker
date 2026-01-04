require('dotenv').config();

const { Client, GatewayIntentBits, Collection, REST, Routes, ActivityType } = require('discord.js');
const collector = require('./collector');
const db = require('./database');
const storage = require('./utils/storage');
const config = require('./config');
const { botLog } = require('./utils/logger');

const activityCommand = require('./commands/activity');
const exportCommand = require('./commands/export');
const helpCommand = require('./commands/help');

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds] 
});

client.commands = new Collection();
client.commands.set(activityCommand.data.name, activityCommand);
client.commands.set(exportCommand.data.name, exportCommand);
client.commands.set(helpCommand.data.name, helpCommand);

let presenceInterval = null;
let isShuttingDown = false;

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
        exportCommand.data.toJSON(),
        helpCommand.data.toJSON()
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
    if (isShuttingDown) {
        if (interaction.isRepliable()) {
            await interaction.reply({
                content: '⚠️ Bot is shutting down, please try again later.',
                ephemeral: true
            });
        }
        return;
    }
    
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

async function shutdown(signal) {
    if (isShuttingDown) {
        botLog.warn('Shutdown already in progress');
        return;
    }
    
    isShuttingDown = true;
    botLog.info({ signal }, 'Shutdown initiated');
    
    // Update presence to show shutting down
    try {
        client.user.setActivity('Shutting down...', { type: ActivityType.Playing });
    } catch (e) {}
    
    if (presenceInterval) {
        clearInterval(presenceInterval);
        presenceInterval = null;
    }
    
    // Stop collector gracefully (waits for collection to finish)
    await collector.stopCollector();
    
    // Close database
    db.closeDb();
    
    // Destroy Discord client
    client.destroy();
    
    botLog.info('Shutdown complete');
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught errors gracefully
process.on('uncaughtException', (error) => {
    botLog.fatal({ error: error.message, stack: error.stack }, 'Uncaught exception');
    shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    botLog.error({ reason: String(reason) }, 'Unhandled rejection');
});

client.login(process.env.DISCORD_TOKEN);