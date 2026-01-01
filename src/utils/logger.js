const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
    level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
    transport: isDev ? {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname'
        }
    } : undefined,
    base: {
        pid: undefined,
        hostname: undefined
    },
    formatters: {
        level: (label) => ({ level: label })
    }
});

// Create child loggers for different modules
module.exports = {
    logger,
    collectorLog: logger.child({ module: 'collector' }),
    apiLog: logger.child({ module: 'api' }),
    dbLog: logger.child({ module: 'db' }),
    hofLog: logger.child({ module: 'hof' }),
    botLog: logger.child({ module: 'bot' }),
    cmdLog: logger.child({ module: 'command' })
};