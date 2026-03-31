/**
 * crypto.js — Chiffrement AES-GCM 256 bits
 * Clé dérivée du PIN utilisateur via PBKDF2 (SHA-256, 100k itérations)
 * Données stockées : { salt, iv, ciphertext } en base64 dans IndexedDB
 */

const ITERATIONS = 100_000;
const KEY_LENGTH = 256;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/** Dérive une clé CryptoKey depuis un PIN (string) et un salt (Uint8Array) */
async function deriveKey(pin, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: KEY_LENGTH },
        false,
        ['encrypt', 'decrypt']
    );
}

/** Chiffre un ArrayBuffer avec le PIN. Retourne { salt, iv, data } en base64 */
export async function encryptData(buffer, pin) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const key = await deriveKey(pin, salt);

    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        buffer
    );

    return {
        salt: bufToB64(salt),
        iv: bufToB64(iv),
        data: ciphertext // Store ArrayBuffer directly
    };
}

/** Déchiffre un objet { salt, iv, data } (base64) avec le PIN. Retourne un ArrayBuffer */
export async function decryptData(encrypted, pin) {
    const salt = b64ToBuf(encrypted.salt);
    const iv = b64ToBuf(encrypted.iv);
    // Legacy support for older capsules that were base64 encoded
    const data = typeof encrypted.data === 'string' ? b64ToBuf(encrypted.data) : encrypted.data;
    
    const key = await deriveKey(pin, salt);

    return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
}

/** Vérifie qu'un PIN peut déchiffrer un enregistrement (test rapide) */
export async function verifyPin(encrypted, pin) {
    try {
        await decryptData(encrypted, pin);
        return true;
    } catch {
        return false;
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function bufToB64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

function b64ToBuf(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}
