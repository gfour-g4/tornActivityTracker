/**
 * Utility script to encrypt existing API keys in config.json
 * Run with: npm run encrypt-keys
 */

const fs = require('fs');
const path = require('path');
const { encrypt, isEncrypted, generateKey } = require('./crypto');

const CONFIG_PATH = path.join(__dirname, '../../config.json');

function main() {
    // Check if ENCRYPTION_KEY is set
    if (!process.env.ENCRYPTION_KEY) {
        console.log('⚠️  ENCRYPTION_KEY not set in environment.\n');
        console.log('To enable encryption:');
        console.log('1. Generate a key:');
        console.log(`   ${generateKey()}`);
        console.log('\n2. Add to your .env file:');
        console.log('   ENCRYPTION_KEY=<generated-key>\n');
        console.log('3. Run this script again.\n');
        return;
    }
    
    // Load config
    let config;
    try {
        config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (error) {
        console.error('❌ Could not read config.json:', error.message);
        return;
    }
    
    if (!config.apikeys || config.apikeys.length === 0) {
        console.log('ℹ️  No API keys found in config.json');
        return;
    }
    
    // Check which keys need encryption
    let encrypted = 0;
    let alreadyEncrypted = 0;
    
    config.apikeys = config.apikeys.map(key => {
        if (isEncrypted(key)) {
            alreadyEncrypted++;
            return key;
        }
        encrypted++;
        return encrypt(key);
    });
    
    if (encrypted === 0) {
        console.log('✅ All API keys are already encrypted.');
        return;
    }
    
    // Save config
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    
    console.log(`✅ Encrypted ${encrypted} API key(s).`);
    if (alreadyEncrypted > 0) {
        console.log(`ℹ️  ${alreadyEncrypted} key(s) were already encrypted.`);
    }
}

// Load dotenv for ENCRYPTION_KEY
require('dotenv').config();
main();