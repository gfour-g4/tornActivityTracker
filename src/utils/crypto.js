const crypto = require('crypto');
const config = require('../config');

const ALGORITHM = config.crypto.algorithm;
const KEY_LENGTH = 32; // 256 bits for aes-256

function getEncryptionKey() {
    const key = process.env.ENCRYPTION_KEY;
    
    if (!key) {
        return null; // Encryption disabled
    }
    
    // If key is hex string, convert to buffer
    if (key.length === 64) {
        return Buffer.from(key, 'hex');
    }
    
    // Otherwise hash it to get consistent 32 bytes
    return crypto.createHash('sha256').update(key).digest();
}

function encrypt(text) {
    const key = getEncryptionKey();
    
    if (!key) {
        return text; // No encryption key, store plaintext
    }
    
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    const encrypted = Buffer.concat([
        cipher.update(text, 'utf8'),
        cipher.final()
    ]);
    
    const tag = cipher.getAuthTag();
    
    // Format: iv:encrypted:tag (all hex)
    return `enc:${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`;
}

function decrypt(encryptedText) {
    // Check if it's encrypted
    if (!encryptedText.startsWith('enc:')) {
        return encryptedText; // Plaintext, return as-is
    }
    
    const key = getEncryptionKey();
    
    if (!key) {
        throw new Error('Cannot decrypt: ENCRYPTION_KEY not set');
    }
    
    const parts = encryptedText.slice(4).split(':'); // Remove 'enc:' prefix
    
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    
    const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
    ]);
    
    return decrypted.toString('utf8');
}

function isEncrypted(text) {
    return text && text.startsWith('enc:');
}

function generateKey() {
    return crypto.randomBytes(KEY_LENGTH).toString('hex');
}

module.exports = {
    encrypt,
    decrypt,
    isEncrypted,
    generateKey
};