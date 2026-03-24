/**
 * app.js — State, routing, IndexedDB, auth
 */

// ── State ──────────────────────────────────────────────────────────────────

const STATE_KEY = 'capsule_user';

export function getState() {
    try { return JSON.parse(sessionStorage.getItem(STATE_KEY)) || {}; }
    catch { return {}; }
}

export function setState(data) {
    sessionStorage.setItem(STATE_KEY, JSON.stringify(data));
}

export function clearState() {
    sessionStorage.removeItem(STATE_KEY);
}

// ── Auth guard ─────────────────────────────────────────────────────────────

export function requireAuth() {
    const state = getState();
    if (!state.name || !state.pin) {
        window.location.href = 'index.html';
        return false;
    }
    return true;
}

// ── Navigation ─────────────────────────────────────────────────────────────

export function navigate(page) {
    window.location.href = page;
}

// ── Toast ──────────────────────────────────────────────────────────────────

export function showToast(message, duration = 2800) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), duration);
}

// ── IndexedDB ──────────────────────────────────────────────────────────────

const DB_NAME = 'CapsuleVideoDB';
const DB_VERSION = 1;
const STORE_CAPS = 'capsules';
const STORE_ACC = 'access';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_CAPS)) {
                db.createObjectStore(STORE_CAPS, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(STORE_ACC)) {
                db.createObjectStore(STORE_ACC, { keyPath: 'id', autoIncrement: true });
            }
        };
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e.target.error);
    });
}

/** Saves encrypted capsule: { id, encryptedVideo, meta } */
export async function saveCapsule(capsule) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_CAPS, 'readwrite');
        tx.objectStore(STORE_CAPS).put(capsule);
        tx.oncomplete = resolve;
        tx.onerror = e => reject(e.target.error);
    });
}

/** Retrieves the latest capsule by user name */
export async function getCapsule(userId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_CAPS, 'readonly');
        const req = tx.objectStore(STORE_CAPS).get(userId);
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e.target.error);
    });
}

/** Deletes a capsule by id */
export async function deleteCapsule(userId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_CAPS, 'readwrite');
        tx.objectStore(STORE_CAPS).delete(userId);
        tx.oncomplete = resolve;
        tx.onerror = e => reject(e.target.error);
    });
}

/** Access list CRUD */
export async function getAccessList() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_ACC, 'readonly');
        const req = tx.objectStore(STORE_ACC).getAll();
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e.target.error);
    });
}

export async function addAccessPerson(person) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_ACC, 'readwrite');
        tx.objectStore(STORE_ACC).add(person);
        tx.oncomplete = resolve;
        tx.onerror = e => reject(e.target.error);
    });
}

export async function removeAccessPerson(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_ACC, 'readwrite');
        tx.objectStore(STORE_ACC).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = e => reject(e.target.error);
    });
}

// ── Service Worker registration ────────────────────────────────────────────

export function registerSW() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .catch(err => console.warn('SW registration failed:', err));
    }
}
