// db.js - Local IndexedDB storage for all app data

const DB_NAME = 'FootballDataDB';
const DB_VERSION = 2; // Incremented version for schema changes
const MATCHES_STORE_NAME = 'matches';
const PREDICTIONS_STORE_NAME = 'predictions';
const SETTINGS_STORE_NAME = 'settings';
const LESSONS_STORE_NAME = 'lessons';

let db;

/**
 * Initializes the IndexedDB database with all required object stores
 */
export function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            
            // Create matches store if it doesn't exist
            if (!database.objectStoreNames.contains(MATCHES_STORE_NAME)) {
                database.createObjectStore(MATCHES_STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
            
            // Create predictions store
            if (!database.objectStoreNames.contains(PREDICTIONS_STORE_NAME)) {
                const predictionsStore = database.createObjectStore(PREDICTIONS_STORE_NAME, { 
                    keyPath: 'id',
                    autoIncrement: true 
                });
                // Create index for easy querying by match date
                predictionsStore.createIndex('matchDate', 'fixture.MatchDate', { unique: false });
                predictionsStore.createIndex('hasResult', 'hasResult', { unique: false });
            }
            
            // Create settings store (key-value pairs)
            if (!database.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
                database.createObjectStore(SETTINGS_STORE_NAME, { keyPath: 'key' });
            }
            
            // Create lessons store
            if (!database.objectStoreNames.contains(LESSONS_STORE_NAME)) {
                const lessonsStore = database.createObjectStore(LESSONS_STORE_NAME, { 
                    keyPath: 'id',
                    autoIncrement: true 
                });
                lessonsStore.createIndex('createdAt', 'createdAt', { unique: false });
            }
        };
        
        request.onsuccess = (event) => {
            db = event.target.result;
            console.log('IndexedDB initialized successfully');
            resolve(db);
        };
        
        request.onerror = (event) => {
            console.error('IndexedDB error:', event.target.error);
            reject(event.target.error);
        };
    });
}

// ==================== MATCHES (Historical Data) ====================

/**
 * Saves historical match data to the database
 */
export function saveDataToDB(matches) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([MATCHES_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(MATCHES_STORE_NAME);
        
        // Clear existing data
        store.clear();
        
        // Add all matches with incrementing IDs
        let counter = 0;
        matches.forEach(match => {
            store.add({ ...match, id: counter++ });
        });
        
        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.error);
    });
}

/**
 * Retrieves all historical matches from the database
 */
export function getAllMatchesFromDB() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([MATCHES_STORE_NAME], 'readonly');
        const store = transaction.objectStore(MATCHES_STORE_NAME);
        const request = store.getAll();
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

// ==================== PREDICTIONS ====================

/**
 * Saves a new prediction to the database
 */
export function savePrediction(prediction) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([PREDICTIONS_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(PREDICTIONS_STORE_NAME);
        
        const predictionToStore = {
            ...prediction,
            unlockedAt: new Date().toISOString(),
            hasResult: !!prediction.result
        };
        
        const request = store.add(predictionToStore);
        
        request.onsuccess = () => {
            console.log('Prediction saved with ID:', request.result);
            resolve(request.result);
        };
        request.onerror = (event) => reject(event.target.error);
    });
}

/**
 * Updates an existing prediction
 */
export function updatePrediction(id, updates) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([PREDICTIONS_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(PREDICTIONS_STORE_NAME);
        
        const getRequest = store.get(id);
        
        getRequest.onsuccess = () => {
            const prediction = getRequest.result;
            if (!prediction) {
                reject(new Error(`Prediction with ID ${id} not found`));
                return;
            }
            
            const updatedPrediction = {
                ...prediction,
                ...updates,
                hasResult: !!(updates.result || prediction.result)
            };
            
            const putRequest = store.put(updatedPrediction);
            putRequest.onsuccess = () => resolve(updatedPrediction);
            putRequest.onerror = (event) => reject(event.target.error);
        };
        
        getRequest.onerror = (event) => reject(event.target.error);
    });
}

/**
 * Gets all predictions
 */
export function getAllPredictions() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([PREDICTIONS_STORE_NAME], 'readonly');
        const store = transaction.objectStore(PREDICTIONS_STORE_NAME);
        const request = store.getAll();
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

/**
 * Gets predictions without results (need result update)
 */
export function getPredictionsNeedingResults() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([PREDICTIONS_STORE_NAME], 'readonly');
        const store = transaction.objectStore(PREDICTIONS_STORE_NAME);
        const index = store.index('hasResult');
        const request = index.getAll(false);
        
        request.onsuccess = () => {
            const today = new Date().toISOString().split('T')[0];
            // Filter to only past matches
            const pastMatches = request.result.filter(p => 
                p.fixture && p.fixture.MatchDate < today
            );
            resolve(pastMatches);
        };
        request.onerror = (event) => reject(event.target.error);
    });
}

/**
 * Gets predictions with results (completed)
 */
export function getCompletedPredictions() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([PREDICTIONS_STORE_NAME], 'readonly');
        const store = transaction.objectStore(PREDICTIONS_STORE_NAME);
        const index = store.index('hasResult');
        const request = index.getAll(true);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

/**
 * Gets upcoming predictions (no result, future date)
 */
export function getUpcomingPredictions() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([PREDICTIONS_STORE_NAME], 'readonly');
        const store = transaction.objectStore(PREDICTIONS_STORE_NAME);
        const request = store.getAll();
        
        request.onsuccess = () => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayStr = today.toISOString().split('T')[0];
            
            const upcoming = request.result.filter(p => 
                p.fixture && p.fixture.MatchDate >= todayStr && !p.result
            );
            resolve(upcoming);
        };
        request.onerror = (event) => reject(event.target.error);
    });
}

/**
 * Deletes a prediction
 */
export function deletePrediction(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([PREDICTIONS_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(PREDICTIONS_STORE_NAME);
        const request = store.delete(id);
        
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    });
}

// ==================== SETTINGS ====================

/**
 * Saves a setting value
 */
export function saveSetting(key, value) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([SETTINGS_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(SETTINGS_STORE_NAME);
        const request = store.put({ key, value });
        
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    });
}

/**
 * Gets a setting value
 */
export function getSetting(key) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([SETTINGS_STORE_NAME], 'readonly');
        const store = transaction.objectStore(SETTINGS_STORE_NAME);
        const request = store.get(key);
        
        request.onsuccess = () => {
            resolve(request.result ? request.result.value : null);
        };
        request.onerror = (event) => reject(event.target.error);
    });
}

/**
 * Gets all settings
 */
export function getAllSettings() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([SETTINGS_STORE_NAME], 'readonly');
        const store = transaction.objectStore(SETTINGS_STORE_NAME);
        const request = store.getAll();
        
        request.onsuccess = () => {
            const settings = {};
            request.result.forEach(item => {
                settings[item.key] = item.value;
            });
            resolve(settings);
        };
        request.onerror = (event) => reject(event.target.error);
    });
}

// ==================== LESSONS ====================

/**
 * Saves a new lesson
 */
export function saveLesson(lessonText) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([LESSONS_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(LESSONS_STORE_NAME);
        
        const lesson = {
            text: lessonText,
            createdAt: new Date().toISOString()
        };
        
        const request = store.add(lesson);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

/**
 * Gets the most recent lessons
 */
export function getRecentLessons(limit = 3) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([LESSONS_STORE_NAME], 'readonly');
        const store = transaction.objectStore(LESSONS_STORE_NAME);
        const index = store.index('createdAt');
        
        const results = [];
        const request = index.openCursor(null, 'prev'); // Descending order
        
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor && results.length < limit) {
                results.push(cursor.value.text);
                cursor.continue();
            } else {
                resolve(results);
            }
        };
        
        request.onerror = (event) => reject(event.target.error);
    });
}

/**
 * Clears all lessons
 */
export function clearLessons() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([LESSONS_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(LESSONS_STORE_NAME);
        const request = store.clear();
        
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    });
}

// ==================== EXPORT / IMPORT ====================

/**
 * Exports all app data as JSON
 */
export async function exportAllData() {
    const data = {
        predictions: await getAllPredictions(),
        settings: await getAllSettings(),
        lessons: await getRecentLessons(100), // Export all lessons
        exportDate: new Date().toISOString(),
        version: DB_VERSION
    };
    return data;
}

/**
 * Imports data from JSON (merges with existing data)
 */
export async function importData(jsonData) {
    if (!jsonData || typeof jsonData !== 'object') {
        throw new Error('Invalid import data');
    }
    
    // Import predictions
    if (jsonData.predictions && Array.isArray(jsonData.predictions)) {
        for (const prediction of jsonData.predictions) {
            // Remove ID to let IndexedDB assign new ones
            const {id, ...predictionData} = prediction;
            await savePrediction(predictionData);
        }
    }
    
    // Import settings
    if (jsonData.settings && typeof jsonData.settings === 'object') {
        for (const [key, value] of Object.entries(jsonData.settings)) {
            await saveSetting(key, value);
        }
    }
    
    // Import lessons
    if (jsonData.lessons && Array.isArray(jsonData.lessons)) {
        for (const lesson of jsonData.lessons) {
            await saveLesson(lesson);
        }
    }
    
    return true;
}

/**
 * Clears all app data (for fresh start)
 */
export function clearAllData() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(
            [PREDICTIONS_STORE_NAME, SETTINGS_STORE_NAME, LESSONS_STORE_NAME],
            'readwrite'
        );
        
        transaction.objectStore(PREDICTIONS_STORE_NAME).clear();
        transaction.objectStore(SETTINGS_STORE_NAME).clear();
        transaction.objectStore(LESSONS_STORE_NAME).clear();
        
        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.error);
    });
}
