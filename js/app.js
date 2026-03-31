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
const DB_VERSION = 4;
const STORE_CAPS = 'capsules';
const STORE_ACC = 'access';
const STORE_HIST = 'history';
const STORE_META = 'meta';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            const tx = e.target.transaction;

            // v1 & v2 migration
            if (!db.objectStoreNames.contains(STORE_CAPS)) {
                db.createObjectStore(STORE_CAPS, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(STORE_ACC)) {
                db.createObjectStore(STORE_ACC, { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains(STORE_HIST)) {
                const histStore = db.createObjectStore(STORE_HIST, { keyPath: 'id', autoIncrement: true });
                histStore.createIndex('date', 'date', { unique: false });
            }
            if (!db.objectStoreNames.contains(STORE_META)) {
                db.createObjectStore(STORE_META, { keyPath: 'key' });
            }

            // v3 migration : Support multi-versions
            if (e.oldVersion < 3) {
                if (db.objectStoreNames.contains(STORE_CAPS)) {
                    db.deleteObjectStore(STORE_CAPS);
                }
                const newCapsStore = db.createObjectStore(STORE_CAPS, { keyPath: 'internalId', autoIncrement: true });
                newCapsStore.createIndex('userId', 'id', { unique: false });
                newCapsStore.createIndex('recordedAt', 'recordedAt', { unique: false });
            }

            // v4 migration : Isolation par utilisateur (userId)
            if (e.oldVersion < 4) {
                // Pour repartir sur une base propre comme demandé :
                // On s'assure que les stores existants ont bien l'index 'userId'
                if (db.objectStoreNames.contains(STORE_ACC)) {
                    const accStore = tx.objectStore(STORE_ACC);
                    if (!accStore.indexNames.contains('userId')) {
                        accStore.createIndex('userId', 'userId', { unique: false });
                    }
                    // On vide systématiquement pour repartir propre
                    accStore.clear();
                }
                if (db.objectStoreNames.contains(STORE_HIST)) {
                    const histStore = tx.objectStore(STORE_HIST);
                    if (!histStore.indexNames.contains('userId')) {
                        histStore.createIndex('userId', 'userId', { unique: false });
                    }
                    // On vide systématiquement pour repartir propre
                    histStore.clear();
                }
            }
        };
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e.target.error);
    });
}

/** Saves encrypted capsule: { id (userId), encryptedVideo, meta... } */
export async function saveCapsule(capsule) {
    const db = await openDB();
    const userId = capsule.id;

    // 1. Récupérer les capsules existantes pour limiter à 2
    const existing = await getCapsules(userId);
    if (existing.length >= 2) {
        // Supprimer la plus ancienne (fin de liste si trié par date DESC)
        const oldest = existing[existing.length - 1];
        await deleteCapsule(oldest.internalId);
    }

    // 2. Enregistrer la nouvelle
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_CAPS, 'readwrite');
        tx.objectStore(STORE_CAPS).add(capsule);
        tx.oncomplete = resolve;
        tx.onerror = e => reject(e.target.error);
    });
}

/** Retrieves sorted capsules by user id (most recent first) */
export async function getCapsules(userId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_CAPS, 'readonly');
        const store = tx.objectStore(STORE_CAPS);
        const index = store.index('userId');
        const req = index.getAll(userId);

        req.onsuccess = () => {
            const list = req.result || [];
            // Trier par date décroissante (plus récent en haut)
            list.sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));
            resolve(list);
        };
        req.onerror = e => reject(e.target.error);
    });
}

/** OBSOLETE but kept for compatibility for now: Returns only the latest capsule */
export async function getCapsule(userId) {
    const list = await getCapsules(userId);
    return list[0] || null;
}

/** Deletes a capsule by internalId */
export async function deleteCapsule(internalId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_CAPS, 'readwrite');
        tx.objectStore(STORE_CAPS).delete(internalId);
        tx.oncomplete = resolve;
        tx.onerror = e => reject(e.target.error);
    });
}

/** Access list CRUD scoping by userId */
export async function getAccessList() {
    const db = await openDB();
    const state = getState();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_ACC, 'readonly');
        const store = tx.objectStore(STORE_ACC);
        const index = store.index('userId');
        const req = index.getAll(state.name || '');
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e.target.error);
    });
}

export async function addAccessPerson(person) {
    const db = await openDB();
    const state = getState();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_ACC, 'readwrite');
        tx.objectStore(STORE_ACC).add({
            ...person,
            userId: person.userId || state.name || ''
        });
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

export async function updateAccessPerson(id, updatedData) {
    const db = await openDB();
    const state = getState();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_ACC, 'readwrite');
        tx.objectStore(STORE_ACC).put({
            ...updatedData,
            id,
            userId: state.name || ''
        });
        tx.oncomplete = resolve;
        tx.onerror = e => reject(e.target.error);
    });
}

// ── History / Activity Log ─────────────────────────────────────────────────

/** Retourne le prochain numéro de capsule (incrémental, jamais remis à zéro) */
export async function getNextCapsuleNumber() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_META, 'readwrite');
        const store = tx.objectStore(STORE_META);
        const req = store.get('capsuleCounter');
        req.onsuccess = () => {
            const current = req.result ? req.result.value : 0;
            const next = current + 1;
            store.put({ key: 'capsuleCounter', value: next });
            tx.oncomplete = () => resolve(next);
        };
        tx.onerror = e => reject(e.target.error);
    });
}

/** Ajoute une entrée dans l'historique, liée à l'utilisateur actuel */
export async function addHistoryEntry(entry) {
    const db = await openDB();
    const state = getState();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_HIST, 'readwrite');
        tx.objectStore(STORE_HIST).add({
            ...entry,
            userId: entry.userId || state.name || '',
            date: entry.date || new Date().toISOString()
        });
        tx.oncomplete = resolve;
        tx.onerror = e => reject(e.target.error);
    });
}

/** Retourne l'historique de l'utilisateur connecté, trié */
export async function getHistory() {
    const db = await openDB();
    const state = getState();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_HIST, 'readonly');
        const store = tx.objectStore(STORE_HIST);
        const index = store.index('userId');
        const req = index.getAll(state.name || '');
        req.onsuccess = () => {
            const entries = req.result || [];
            entries.sort((a, b) => new Date(b.date) - new Date(a.date));
            resolve(entries);
        };
        req.onerror = e => reject(e.target.error);
    });
}

/** Vide l'historique de l'utilisateur connecté */
export async function clearHistory() {
    const db = await openDB();
    const state = getState();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_HIST, 'readwrite');
        const store = tx.objectStore(STORE_HIST);
        const index = store.index('userId');
        const req = index.openKeyCursor(IDBKeyRange.only(state.name || ''));
        req.onsuccess = e => {
            const cursor = e.target.result;
            if (cursor) {
                store.delete(cursor.primaryKey);
                cursor.continue();
            }
        };
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

/**
 * Initialise les données de démo (Contacts + Historique)
 */
export async function seedDemoData() {
    const db = await openDB();
    
    // Vérifier si des données existent déjà pour l'utilisateur de démo
    const tx = db.transaction(STORE_HIST, 'readonly');
    const store = tx.objectStore(STORE_HIST);
    const index = store.index('userId');
    const req = index.getAll('Émilie');
    
    const existing = await new Promise(r => {
        req.onsuccess = () => r(req.result);
    });
    
    if (existing && existing.length > 0) return; 

    // 1. Ajouter les contacts fictifs (Frank, Eva, Sam)
    const contacts = [
        { name: 'Frank PARLER', role: 'confiance', contact: 'f.parler@avocat.fr', addedAt: '2026-01-10T09:00:00Z', userId: 'Émilie' },
        { name: 'Eva VEILLER', role: 'famille', contact: 'eva@famille.fr', addedAt: '2026-01-12T14:30:00Z', userId: 'Émilie' },
        { name: 'Sam SOUCI', role: 'soignant', contact: 'Dr. Sam Souci - CMP Centre', addedAt: '2026-02-05T11:15:00Z', userId: 'Émilie' }
    ];
    
    for (const c of contacts) {
        await addAccessPerson(c);
    }

    // 2. Ajouter l'historique fictif (actions chronologiques)
    const history = [
        { type: 'import', date: '2026-01-08T10:15:00Z', details: { capsuleNumber: 1, duration: 245 }, userId: 'Émilie' },
        { type: 'access_add', date: '2026-01-10T09:05:00Z', details: { contactName: 'Frank PARLER', role: 'confiance' }, userId: 'Émilie' },
        { type: 'record', date: '2026-01-10T11:30:00Z', details: { capsuleNumber: 2, duration: 184 }, userId: 'Émilie' },
        { type: 'access_add', date: '2026-01-12T14:35:00Z', details: { contactName: 'Eva VEILLER', role: 'famille' }, userId: 'Émilie' },
        { type: 'delete', date: '2026-01-25T10:00:00Z', details: { capsuleNumber: 2 }, userId: 'Émilie' },
        { type: 'access_add', date: '2026-02-05T11:20:00Z', details: { contactName: 'Sam SOUCI', role: 'soignant' }, userId: 'Émilie' },
        { type: 'record', date: '2026-02-10T09:00:00Z', details: { capsuleNumber: 3, duration: 210 }, userId: 'Émilie' }
    ];
    
    for (const h of history) {
        await addHistoryEntry(h);
    }

    // 3. Initialiser le compteur de capsules à 3 (la prochaine sera la 4)
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_META, 'readwrite');
        tx.objectStore(STORE_META).put({ key: 'capsuleCounter', value: 3 });
        tx.oncomplete = resolve;
        tx.onerror = e => reject(e.target.error);
    });
}
