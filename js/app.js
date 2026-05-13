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
        window.location.replace('index.html');
        return false;
    }
    return true;
}

// ── Security Auto-Lock ─────────────────────────────────────────────────────

/**
 * Verrouille l'application immédiatement si elle est mise en arrière-plan.
 * On utilise sessionStorage, donc l'onglet garde les données tant qu'il est ouvert,
 * SAUF si on force le nettoyage lors de la mise en pause.
 */
if (typeof window !== 'undefined') {
    // Gestion du cycle de vie pour la sécurité (Auto-Lock avec délai de grâce)
    const LOCK_GRACE_PERIOD = 60 * 1000; // 60 secondes de grâce

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            // On enregistre le moment où l'app passe en arrière-plan
            sessionStorage.setItem('last_hidden_time', Date.now().toString());
        } else if (document.visibilityState === 'visible') {
            const lastHidden = sessionStorage.getItem('last_hidden_time');
            if (lastHidden) {
                const elapsed = Date.now() - parseInt(lastHidden, 10);
                sessionStorage.removeItem('last_hidden_time');

                // Si l'app est restée cachée plus que le délai de grâce, on verrouille
                if (elapsed > LOCK_GRACE_PERIOD) {
                    clearState();
                    window.location.replace('index.html');
                }
            }
        }
    });

    // Protection contre le BFcache (bouton retour sur mobile)
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) {
            // La page est chargée depuis le cache (bouton retour)
            // On force une vérification d'auth
            if (!getState().name || !getState().pin) {
                window.location.replace('index.html');
            }
        }
    });
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
const DB_VERSION = 6;
const STORE_CAPS = 'capsules';
const STORE_ACC = 'access';
const STORE_HIST = 'history';
const STORE_META = 'meta';
const STORE_PROFILES = 'profiles';
const STORE_SCRIPTS = 'scripts';

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

            // v5 migration : Profil utilisateur (Faisons Connaissance)
            if (e.oldVersion < 5) {
                if (!db.objectStoreNames.contains(STORE_PROFILES)) {
                    db.createObjectStore(STORE_PROFILES, { keyPath: 'userId' });
                }
            }

            // v6 migration : Scripts DAP structurés (Téléprompter)
            if (e.oldVersion < 6) {
                if (!db.objectStoreNames.contains(STORE_SCRIPTS)) {
                    db.createObjectStore(STORE_SCRIPTS, { keyPath: 'userId' });
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

    // 1. Nettoyer les capsules trop vieilles (>48h)
    await cleanupCapsules();

    // 2. Récupérer les capsules existantes pour limiter à 2 actives
    const existing = await getCapsules(userId, false);
    if (existing.length >= 2) {
        // Supprimer logiquement la plus ancienne (fin de liste si trié par date DESC)
        const oldest = existing[existing.length - 1];
        await softDeleteCapsule(oldest.internalId);
    }

    // 3. Enregistrer la nouvelle
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_CAPS, 'readwrite');
        tx.objectStore(STORE_CAPS).add(capsule);
        tx.oncomplete = resolve;
        tx.onerror = e => reject(e.target.error);
    });
}

/** Retrieves sorted capsules by user id (most recent first) */
export async function getCapsules(userId, includeTrashed = false) {
    const db = await openDB();
    // On nettoie au passage
    cleanupCapsules().catch(e => console.warn(e));

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_CAPS, 'readonly');
        const store = tx.objectStore(STORE_CAPS);
        const index = store.index('userId');
        const req = index.getAll(userId);

        req.onsuccess = () => {
            let list = req.result || [];
            if (!includeTrashed) {
                list = list.filter(c => !c.deletedAt);
            }
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

export async function softDeleteCapsule(internalId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_CAPS, 'readwrite');
        const store = tx.objectStore(STORE_CAPS);
        const req = store.get(internalId);
        req.onsuccess = () => {
            const capsule = req.result;
            if (capsule) {
                capsule.deletedAt = new Date().toISOString();
                store.put(capsule);
            }
        };
        tx.oncomplete = resolve;
        tx.onerror = e => reject(e.target.error);
    });
}

export async function restoreCapsule(internalId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_CAPS, 'readwrite');
        const store = tx.objectStore(STORE_CAPS);
        const req = store.get(internalId);
        req.onsuccess = () => {
            const capsule = req.result;
            if (capsule) {
                delete capsule.deletedAt;
                store.put(capsule);
            }
        };
        tx.oncomplete = resolve;
        tx.onerror = e => reject(e.target.error);
    });
}

export async function getTrashedCapsules(userId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_CAPS, 'readonly');
        const store = tx.objectStore(STORE_CAPS);
        const index = store.index('userId');
        const req = index.getAll(userId);

        req.onsuccess = () => {
            let list = req.result || [];
            list = list.filter(c => !!c.deletedAt);
            list.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
            resolve(list);
        };
        req.onerror = e => reject(e.target.error);
    });
}

export async function cleanupCapsules() {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_CAPS, 'readwrite');
            const store = tx.objectStore(STORE_CAPS);
            const req = store.getAll();

            req.onsuccess = () => {
                const list = req.result || [];
                const now = new Date();
                list.forEach(capsule => {
                    if (capsule.deletedAt) {
                        const deletedDate = new Date(capsule.deletedAt);
                        const diffHours = (now - deletedDate) / (1000 * 60 * 60);
                        if (diffHours > 48) {
                            store.delete(capsule.internalId);
                        }
                    }
                });
            };
            tx.oncomplete = resolve;
            tx.onerror = e => reject(e.target.error);
        });
    } catch (e) {
        console.warn('Cleanup error:', e);
    }
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

// ── User Profile ───────────────────────────────────────────────────────────

export async function getUserProfile(userId) {
    const db = await openDB();
    const uid = userId || getState().name;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_PROFILES, 'readonly');
        const store = tx.objectStore(STORE_PROFILES);
        const req = store.get(uid);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = e => reject(e.target.error);
    });
}

export async function saveUserProfile(profileData) {
    const db = await openDB();
    const state = getState();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_PROFILES, 'readwrite');
        tx.objectStore(STORE_PROFILES).put({
            ...profileData,
            userId: profileData.userId || state.name || ''
        });
        tx.oncomplete = resolve;
        tx.onerror = e => reject(e.target.error);
    });
}

// ── Script DAP (Téléprompter) ───────────────────────────────────────────────

/**
 * Sauvegarde le script DAP structuré de l'utilisateur connecté.
 * @param {Object} scriptData - { section1, section2, section3, section4 }
 */
export async function saveScript(scriptData) {
    const db = await openDB();
    const state = getState();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SCRIPTS, 'readwrite');
        tx.objectStore(STORE_SCRIPTS).put({
            ...scriptData,
            userId: state.name || '',
            updatedAt: new Date().toISOString()
        });
        tx.oncomplete = resolve;
        tx.onerror = e => reject(e.target.error);
    });
}

/**
 * Récupère le script DAP de l'utilisateur connecté.
 * @returns {Object|null} - { section1, section2, section3, section4, updatedAt } ou null
 */
export async function getScript() {
    const db = await openDB();
    const state = getState();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SCRIPTS, 'readonly');
        const req = tx.objectStore(STORE_SCRIPTS).get(state.name || '');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = e => reject(e.target.error);
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

    // 0. Ajouter le profil fictif pour Émilie
    await saveUserProfile({
        userId: 'Émilie',
        firstName: 'Émilie',
        lastName: 'André',
        email: 'emilie.a@example.com',
        phone: '06 12 34 56 78'
    });

    // 1. Ajouter les contacts fictifs (Frank, Eva, Sam)
    const contacts = [
        { name: 'Frank PARLER', role: 'confiance', email: 'f.parler@avocat.fr', phone: '06 12 34 56 78', addedAt: '2026-01-10T09:00:00Z', userId: 'Émilie' },
        { name: 'Eva VEILLER', role: 'famille', email: 'eva@famille.fr', addedAt: '2026-01-12T14:30:00Z', userId: 'Émilie' },
        { name: 'Sam SOUCI', role: 'soignant', phone: '04 67 00 11 22', addedAt: '2026-02-05T11:15:00Z', userId: 'Émilie' }
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
        { type: 'delete', date: '2026-01-09T10:00:00Z', details: { capsuleNumber: 1 }, userId: 'Émilie' },
        { type: 'access_add', date: '2026-02-05T11:20:00Z', details: { contactName: 'Sam SOUCI', role: 'soignant' }, userId: 'Émilie' },
        { type: 'record', date: '2026-03-24T09:00:00Z', details: { capsuleNumber: 3, duration: 210 }, userId: 'Émilie' }
    ];

    for (const h of history) {
        await addHistoryEntry(h);
    }

    // 3. Ajouter un script pré-rempli pour le téléprompter de la démo
    await saveScript({
        userId: 'Émilie',
        section1: "Bonjour, nous sommes le 10 janvier 2026 et c'est la troisième capsule vidéo pour le rétablissement que je fais. Je m'appelle Émilie André. Je suis atteinte d'un trouble bipolaire de type 1 et je suis plutôt sujette à faire des phases up de décompensation maniaque. Depuis 2019, je n'ai pas fait de crise et je suis stabilisée.",
        section2: "Je fais cette vidéo pour énoncer mes directives anticipées en psychiatrie et me soutenir en cas de crise tout d'abord, vu que je travaille et collabore avec le Bon Sauveur, il n'est pas possible pour moi d'être hospitalisé dans cette structure sur Albi. Du coup, il me faudrait que je sois transféré dans une clinique ou un hôpital sur Toulouse. En temps normal, je prends très peu de traitement, je suis sous 7 mg d'albinify ou aripiprazole plus une pilule contraceptive optimizette en continu.",
        section3: "S'il vous plaît si je suis dans un état vraiment altéré de conscience, merci de ne pas m'enlever mes bijoux, je les porte tout le temps. Et je ne les enlève pas, je ne me ferai pas de mal, je vous je vous rassure. Merci de ne pas me mettre en contention et si possible pas en isolement non plus, expliquez-moi ce qui m'arrive et permettez-moi de visionner cette capsule vidéo pour le rétablissement. Si je suis hospitalisé, je souhaite être dans une chambre individuelle avoir accès à de la musique, à mon téléphone du coup. Que je puisse faire des créations artistiques, de la lecture, du sport très importante et des ateliers thérapeutiques. Attention à la nourriture. Le matin, je déjeune simplement avec un café et je sais par expérience que j'ai tendance à vraiment prendre du poids en hospitalisation. Donc merci de de m'aider à ne pas prendre de poids. Je ne suis pas fumeuse de tabac si vraiment je ressens le besoin de fumer et ben merci de me procurer une cigarette électronique sans nicotine. Pour ce qui est de ma maison merci de s'occuper des plantes et de les arroser et de vider le frigo des denrées qui sont périssables, de m'apporter des habits nécessaires et un nécessaire de toilette.",
        section4: "Émilie, il faut vraiment que tu te reposes que tu calmes le mental. Essaie de demander à ton entourage familial amical et ainsi qu'aux soignants de t'aider à y voir clair dans tes idées délirantes. Je suis une femme forte ce que je vis là, c'est n'est qu'un passage ce trouble bipolaire ne me définit pas, c'est quelque chose qui fait partie de moi mais qui correspond pas à mon identité, je vais m'en sortir. Prend de grande respiration, essaie de faire de la cohérence cardiaque comme tu le dis tout le temps, la temporalité est ton allié, rien n'est permanent. Courage, force et espoir. Et n'oublie pas que tu es très bien entouré et que tu es aimé.",
        updatedAt: '2026-01-10T11:00:00Z'
    });

    // 4. Initialiser le compteur de capsules à 3 (la prochaine sera la 4)
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_META, 'readwrite');
        tx.objectStore(STORE_META).put({ key: 'capsuleCounter', value: 3 });
        tx.oncomplete = resolve;
        tx.onerror = e => reject(e.target.error);
    });
}
