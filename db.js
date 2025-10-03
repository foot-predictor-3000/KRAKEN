// db.js
const DB_NAME = 'CaptainTurfbeardDB';
const DB_VERSION = 1;
const MATCHES_STORE_NAME = 'matches';
const PREDICTIONS_STORE_NAME = 'user_predictions'; // New store for user data
let db;

/**
 * Initializes the IndexedDB database and creates object stores.
 * @returns {Promise<IDBDatabase>} A promise that resolves with the database instance.
 */
export function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const dbInstance = event.target.result;
            if (!dbInstance.objectStoreNames.contains(MATCHES_STORE_NAME)) {
                dbInstance.createObjectStore(MATCHES_STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
            // Create the new object store for user predictions
            if (!dbInstance.objectStoreNames.contains(PREDICTIONS_STORE_NAME)) {
                // 'id' will be the canonical fixture ID, which is unique
                dbInstance.createObjectStore(PREDICTIONS_STORE_NAME, { keyPath: 'id' });
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };

        request.onerror = (event) => {
            console.error('Database error:', event.target.errorCode);
            reject(event.target.errorCode);
        };
    });
}

/**
 * Saves historical match data to the 'matches' store.
 * @param {Array<object>} matches The array of match objects to save.
 * @returns {Promise<void>}
 */
export function saveDataToDB(matches) {
    return new Promise((resolve, reject) => {
        if (!db) return reject("Database not initialized.");
        const transaction = db.transaction([MATCHES_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(MATCHES_STORE_NAME);
        store.clear(); // Clear old data before adding new
        let counter = 0;
        matches.forEach(match => {
            store.add({ ...match, id: counter++ });
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.error);
    });
}

/**
 * Retrieves all matches from the 'matches' store.
 * @returns {Promise<Array<object>>}
 */
export function getAllMatchesFromDB() {
    return new Promise((resolve, reject) => {
        if (!db) return reject("Database not initialized.");
        const transaction = db.transaction([MATCHES_STORE_NAME], 'readonly');
        const store = transaction.objectStore(MATCHES_STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

// --- New Functions for User Predictions ---

/**
 * Saves or updates a user's prediction in the 'user_predictions' store.
 * @param {object} prediction The prediction object to save.
 * @returns {Promise<void>}
 */
export function savePrediction(prediction) {
    return new Promise((resolve, reject) => {
        if (!db) return reject("Database not initialized.");
        const transaction = db.transaction([PREDICTIONS_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(PREDICTIONS_STORE_NAME);
        const request = store.put(prediction); // put() will add or update based on keyPath
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    });
}

/**
 * Retrieves all user predictions from the 'user_predictions' store.
 * @returns {Promise<Array<object>>}
 */
export function getAllPredictions() {
    return new Promise((resolve, reject) => {
        if (!db) return reject("Database not initialized.");
        const transaction = db.transaction([PREDICTIONS_STORE_NAME], 'readonly');
        const store = transaction.objectStore(PREDICTIONS_STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = (event) => reject(event.target.error);
    });
}

/**
 * Retrieves a single prediction by its ID.
 * @param {string} id The canonical ID of the prediction.
 * @returns {Promise<object|undefined>}
 */
export function getPredictionById(id) {
    return new Promise((resolve, reject) => {
        if (!db) return reject("Database not initialized.");
        const transaction = db.transaction([PREDICTIONS_STORE_NAME], 'readonly');
        const store = transaction.objectStore(PREDICTIONS_STORE_NAME);
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

/**
 * Deletes a prediction by its ID.
 * @param {string} id The canonical ID of the prediction to delete.
 * @returns {Promise<void>}
 */
export function deletePrediction(id) {
    return new Promise((resolve, reject) => {
        if (!db) return reject("Database not initialized.");
        const transaction = db.transaction([PREDICTIONS_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(PREDICTIONS_STORE_NAME);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    });
}

/**
 * Clears all user predictions from the database.
 * @returns {Promise<void>}
 */
export function clearAllPredictions() {
    return new Promise((resolve, reject) => {
        if (!db) return reject("Database not initialized.");
        const transaction = db.transaction([PREDICTIONS_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(PREDICTIONS_STORE_NAME);
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    });
}
