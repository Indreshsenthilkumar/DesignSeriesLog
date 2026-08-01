// ============================================================
//  DesignSeries Performance Architecture State Store (store.js)
// ============================================================

(function () {
    const DB_NAME = 'DesignSeriesDB';
    const DB_VERSION = 1;
    const STORE_NAME = 'module_cache';
    const QUEUE_STORE = 'offline_queue';
    let db = null;

    // --- IndexedDB Core Setup ---
    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = (event) => reject(event.target.error);
            request.onsuccess = (event) => {
                db = event.target.result;
                resolve(db);
            };
            request.onupgradeneeded = (event) => {
                const activeDb = event.target.result;
                if (!activeDb.objectStoreNames.contains(STORE_NAME)) {
                    activeDb.createObjectStore(STORE_NAME);
                }
                if (!activeDb.objectStoreNames.contains(QUEUE_STORE)) {
                    activeDb.createObjectStore(QUEUE_STORE, { autoIncrement: true });
                }
            };
        });
    }

    // --- DB Helper Operations ---
    function getDBItem(store, key) {
        return new Promise((resolve) => {
            if (!db) return resolve(null);
            const transaction = db.transaction([store], 'readonly');
            const objectStore = transaction.objectStore(store);
            const request = objectStore.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
        });
    }

    function setDBItem(store, key, value) {
        return new Promise((resolve) => {
            if (!db) return resolve(false);
            const transaction = db.transaction([store], 'readwrite');
            const objectStore = transaction.objectStore(store);
            const request = objectStore.put(value, key);
            request.onsuccess = () => resolve(true);
            request.onerror = () => resolve(false);
        });
    }

    function deleteDBItem(store, key) {
        return new Promise((resolve) => {
            if (!db) return resolve(false);
            const transaction = db.transaction([store], 'readwrite');
            const objectStore = transaction.objectStore(store);
            const request = objectStore.delete(key);
            request.onsuccess = () => resolve(true);
            request.onerror = () => resolve(false);
        });
    }

    function getAllQueueItems() {
        return new Promise((resolve) => {
            if (!db) return resolve([]);
            const transaction = db.transaction([QUEUE_STORE], 'readonly');
            const objectStore = transaction.objectStore(QUEUE_STORE);
            const request = objectStore.openCursor();
            const results = [];
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    results.push({ key: cursor.key, value: cursor.value });
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = () => resolve([]);
        });
    }

    // --- Global Memory Store & Cache Engine ---
    const memoryCache = {};

    window.AppStore = {
        async init() {
            try {
                await initDB();
                console.log('AppStore DB initialized successfully.');
                // Warm cache from IndexedDB
                const cachedModules = ['attendance', 'worklogs', 'tasks', 'notifications', 'surveys', 'admin'];
                for (const mod of cachedModules) {
                    const data = await getDBItem(STORE_NAME, mod);
                    if (data) {
                        memoryCache[mod] = data;
                    }
                }
                this.setupNetworkMonitoring();
            } catch (err) {
                console.error('Failed to initialize AppStore DB:', err);
            }
        },

        // Get value from memory cache with fallback to local storage / DB
        get(moduleName, defaultValue = null) {
            if (memoryCache[moduleName]) {
                const entry = memoryCache[moduleName];
                // Check TTL expiry
                if (entry.expiry && Date.now() > entry.expiry) {
                    entry.stale = true;
                }
                return entry.data;
            }
            // LocalStorage fallback for high priority fast reads
            const lsValue = localStorage.getItem(`cache_${moduleName}`);
            if (lsValue) {
                try {
                    const parsed = JSON.parse(lsValue);
                    memoryCache[moduleName] = parsed;
                    return parsed.data;
                } catch (e) {
                    return defaultValue;
                }
            }
            return defaultValue;
        },

        // Set value in memory cache and async persist to IndexedDB/LocalStorage
        async set(moduleName, data, options = {}) {
            const ttl = options.ttl || (5 * 60 * 1000); // Default 5 mins TTL
            const entry = {
                data: data,
                expiry: Date.now() + ttl,
                stale: false,
                lastUpdated: Date.now()
            };

            memoryCache[moduleName] = entry;

            // Direct local storage mirror for fast boot items
            if (options.useLocalStorage) {
                localStorage.setItem(`cache_${moduleName}`, JSON.stringify(entry));
            }

            // Always write to IndexedDB async
            await setDBItem(STORE_NAME, moduleName, entry);
            
            // Dispatch dynamic store change event for reactive rendering
            window.dispatchEvent(new CustomEvent(`store:${moduleName}`, { detail: data }));
        },

        // --- Safe POST helper with offline queueing fallback ---
        async safePost(url, body) {
            if (!navigator.onLine) {
                console.warn("Device is offline. Queuing request:", body);
                await this.enqueueOfflineAction('POST', { url, body });
                return { status: 'success', offline: true };
            }
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    body: JSON.stringify(body)
                });
                const data = await response.json();
                return data;
            } catch (err) {
                console.warn("Network request failed, queuing request:", err);
                await this.enqueueOfflineAction('POST', { url, body });
                return { status: 'success', offline: true };
            }
        },

        // --- Offline WriteBack Queue Logic ---
        async enqueueOfflineAction(actionName, payload) {
            const item = {
                action: actionName,
                payload: payload,
                timestamp: Date.now()
            };
            if (db) {
                await setDBItem(QUEUE_STORE, Date.now(), item);
            }
            this.updateSyncIndicator(true);
        },

        async processOfflineQueue(syncCallback) {
            if (!navigator.onLine) return;
            const items = await getAllQueueItems();
            if (items.length === 0) {
                this.updateSyncIndicator(false);
                return;
            }

            console.log(`Processing ${items.length} offline queued actions...`);
            for (const item of items) {
                try {
                    const success = await syncCallback(item.value.action, item.value.payload);
                    if (success) {
                        await deleteDBItem(QUEUE_STORE, item.key);
                    }
                } catch (e) {
                    console.error('Failed to sync offline item:', e);
                }
            }

            const remaining = await getAllQueueItems();
            this.updateSyncIndicator(remaining.length > 0);
        },

        setupNetworkMonitoring() {
            window.addEventListener('online', () => {
                console.log('App is online. Synchronizing data...');
                window.dispatchEvent(new CustomEvent('app:online'));
                this.processOfflineQueue(async (action, payload) => {
                    try {
                        const response = await fetch(payload.url, {
                            method: action,
                            body: JSON.stringify(payload.body)
                        });
                        const data = await response.json();
                        return data.status === 'success' || data.success || data.offline;
                    } catch (e) {
                        return false;
                    }
                });
            });
            window.addEventListener('offline', () => {
                console.log('App went offline.');
                window.dispatchEvent(new CustomEvent('app:offline'));
                this.updateSyncIndicator(true);
            });
            // Try syncing on start in case there are pending actions
            setTimeout(() => {
                if (navigator.onLine) {
                    this.processOfflineQueue(async (action, payload) => {
                        try {
                            const response = await fetch(payload.url, {
                                method: action,
                                body: JSON.stringify(payload.body)
                            });
                            const data = await response.json();
                            return data.status === 'success' || data.success || data.offline;
                        } catch (e) {
                            return false;
                        }
                    });
                }
            }, 3000);
        },

        updateSyncIndicator(hasPendingSync) {
            let indicator = document.getElementById('sync-indicator');
            if (!indicator) {
                indicator = document.createElement('div');
                indicator.id = 'sync-indicator';
                indicator.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:9999;background:rgba(15,23,42,0.85);backdrop-filter:blur(8px);color:#10B981;padding:8px 14px;border-radius:20px;font-size:0.75rem;font-weight:700;display:flex;align-items:center;gap:6px;border:1px solid rgba(255,255,255,0.1);transition:opacity 0.3s;box-shadow:0 4px 12px rgba(0,0,0,0.15);pointer-events:none;';
                indicator.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#10B981;display:inline-block;animation:pulse 1.5s infinite;"></span> Offline Mode (Syncing)';
                document.body.appendChild(indicator);
            }
            if (hasPendingSync) {
                indicator.style.opacity = '1';
                indicator.style.display = 'flex';
            } else {
                indicator.style.opacity = '0';
                setTimeout(() => {
                    if (indicator.style.opacity === '0') {
                        indicator.style.display = 'none';
                    }
                }, 300);
            }
        }
    };

    // Auto-init on script load
    document.addEventListener('DOMContentLoaded', () => {
        window.AppStore.init();
        
        // --- GLOBAL ERROR BOUNDARY ---
        window.addEventListener('error', (event) => {
            console.error("DesignSeries Global Error Boundary Captured:", event.error);
            if (typeof showToast === 'function') {
                showToast('error', 'Unexpected Error', 'Something went wrong, but your data is safe.');
            }
        });
    });
})();
