// main.js (Client-Side Version - Restored to original logic)

import {
    findFixtures, getOddsForFixtures, getQuartermasterReport, getCaptainReview,
    setApiKey, getApiKey, fetchResultsFromSource
} from './gemini-client.js';
import {
    initDB, getAllMatchesFromDB, saveDataToDB, getAllPredictions,
    savePrediction, getPredictionById, clearAllPredictions
} from './db.js';
import { initWorker, trainModels, runPrediction, cleanupWorker } from './worker-handler.js';
import {
    setStatus, setGeminiStatus, initializeToggleListeners, renderFixtureUI,
    renderLedgerAndCharts, showAnalysisModal, displayStatisticalReasoning
} from './ui.js';
import { registerServiceWorker } from './pwa.js';

// --- Global State ---
export let allFoundFixtures = [];
export let unlockedPredictions = [];
export let trainedLeagueCode = null;

// --- State Setters ---
export function setAllFoundFixtures(fixtures) { allFoundFixtures = Array.isArray(fixtures) ? fixtures : []; }
export function setUnlockedPredictions(predictions) { unlockedPredictions = Array.isArray(predictions) ? predictions : []; }

// --- Helper Functions ---
function getCanonicalFixtureId(fixture) {
    if (!fixture || !fixture.HomeTeam || !fixture.AwayTeam || !fixture.MatchDate) return `invalid-${Date.now()}`;
    const home = fixture.HomeTeam.toLowerCase().replace(/[^a-z0-9]/g, '');
    const away = fixture.AwayTeam.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${home}-vs-${away}-${fixture.MatchDate}`;
}

async function refreshPredictionsFromDB() {
    const predictions = await getAllPredictions();
    setUnlockedPredictions(predictions);
    renderFixtureUI();
    renderLedgerAndCharts(predictions);
    // After rendering, ensure the correct sections are visible
    document.getElementById('unlocked-predictions-section').classList.toggle('hidden', predictions.length === 0);
}

// --- Core Application Logic ---
async function findAndDisplayFixtures() {
    try {
        const leagueSelect = document.getElementById('league-select');
        const leagueName = leagueSelect.options[leagueSelect.selectedIndex].text;
        const leagueCode = leagueSelect.value;
        const isTestMode = document.getElementById('test-mode-checkbox')?.checked || false;

        setGeminiStatus('Scanning the horizon for fixtures...', true);
        document.getElementById('fixtures-selection-area').classList.add('hidden');

        const rawFixtures = await findFixtures(leagueName, isTestMode);
        if (rawFixtures.length === 0) {
            setGeminiStatus('No skirmishes found for this league.', false);
            setAllFoundFixtures([]); renderFixtureUI();
            document.getElementById('fixtures-selection-area').classList.remove('hidden');
            return;
        }

        setGeminiStatus(`Spotted ${rawFixtures.length} voyages... checking odds...`, true);
        const oddsMap = await getOddsForFixtures(rawFixtures);

        const fixturesWithDetails = rawFixtures.map(f => {
            const key = `${f.HomeTeam.replace(/\s/g, '')}${f.AwayTeam.replace(/\s/g, '')}${f.MatchDate}`;
            const odds = oddsMap[key] || { HomeWinOdds: 'N/A', DrawOdds: 'N/A', AwayWinOdds: 'N/A' };
            return { ...f, id: getCanonicalFixtureId(f), leagueCode, ...odds };
        }).filter(f => f.HomeWinOdds !== 'N/A');

        setAllFoundFixtures(fixturesWithDetails);
        renderFixtureUI();
        setGeminiStatus(`Found ${fixturesWithDetails.length} skirmishes. Choose to unlock.`, false);
        document.getElementById('fixtures-selection-area').classList.remove('hidden');

    } catch (error) {
        setGeminiStatus(`<span class="text-red-500">${error.message}</span>`, false);
    }
}

async function unlockFixture(fixtureToUnlock) {
    const canonicalId = getCanonicalFixtureId(fixtureToUnlock);
    if (await getPredictionById(canonicalId)) {
        alert("Ye have already unlocked this skirmish!"); return;
    }
    await savePrediction({
        id: canonicalId, fixture: fixtureToUnlock, unlockedAt: new Date(),
        krakenAnalysis: null, quartermasterReport: null, captainReview: null,
        userGuess: null, result: null
    });
    await refreshPredictionsFromDB();
}

async function manualFetchResults() {
    setStatus("Checking the port for news of past skirmishes...", true);
    const predictions = await getAllPredictions();
    const incomplete = predictions.filter(p => !p.result && new Date(p.fixture.MatchDate) < new Date());
    if (incomplete.length === 0) {
        setStatus("All past predictions are up-to-date.", false); return;
    }

    const predictionsBySeason = incomplete.reduce((acc, p) => {
        const date = new Date(p.fixture.MatchDate);
        const year = date.getUTCFullYear(), month = date.getUTCMonth();
        const end = (month >= 7) ? year + 1 : year, start = end - 1;
        const season = `${(start % 100).toString().padStart(2, '0')}${(end % 100).toString().padStart(2, '0')}`;
        const key = `${p.fixture.leagueCode}-${season}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push(p);
        return acc;
    }, {});

    let updatedCount = 0;
    for (const key in predictionsBySeason) {
        const [leagueCode, season] = key.split('-');
        try {
            const resultsMap = await fetchResultsFromSource(leagueCode, season);
            for (const p of predictionsBySeason[key]) {
                const lookupKey = `${p.fixture.HomeTeam}-${p.fixture.AwayTeam}-${p.fixture.MatchDate}`;
                if (resultsMap.has(lookupKey)) {
                    p.result = resultsMap.get(lookupKey);
                    await savePrediction(p); updatedCount++;
                }
            }
        } catch (error) { console.error(`Could not fetch results for ${key}:`, error); }
    }
    setStatus(`Updated ${updatedCount} prediction(s) with final results.`, false);
    await refreshPredictionsFromDB();
}

function generatePersonalInsights() { /* Logic unchanged from previous response */ }
async function exportData() { /* Logic unchanged from previous response */ }
async function importData() { /* Logic unchanged from previous response */ }

// --- Initialization & Event Listeners ---
document.addEventListener('DOMContentLoaded', async () => {
    registerServiceWorker();
    initializeToggleListeners();
    await initDB();
    initWorker();
    setStatus('Choose yer ocean and plunder the depths.', false);

    const savedApiKey = localStorage.getItem('geminiApiKey');
    if (savedApiKey) {
        setApiKey(savedApiKey);
        document.getElementById('api-key-input').value = savedApiKey;
    }
    
    await refreshPredictionsFromDB();

    // Setup Modals
    const setupModal = (modalId, openBtnId, closeBtnId) => {
        const modal = document.getElementById(modalId), openBtn = document.getElementById(openBtnId), closeBtn = document.getElementById(closeBtnId);
        if(modal && openBtn && closeBtn) {
            openBtn.addEventListener('click', () => modal.classList.remove('hidden'));
            closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
            modal.addEventListener('click', (e) => e.target === modal && modal.classList.add('hidden'));
        }
    };
    setupModal('log-book-section', 'log-book-btn', 'close-log-book-btn');
    setupModal('helm-modal', 'open-helm-btn', 'close-helm-btn');
    setupModal('analysis-modal', null, 'close-analysis-modal-btn'); // For analysis view

    // Main button listeners
    document.getElementById('fetch-data-btn').addEventListener('click', async () => { /* fetch logic */ });
    document.getElementById('find-fixtures-btn').addEventListener('click', findAndDisplayFixtures);
    document.getElementById('train-models-btn').addEventListener('click', async () => {
        const matches = await getAllMatchesFromDB();
        if (matches.length === 0) return setStatus('No data to train on!', false);
        const settings = JSON.parse(localStorage.getItem('krakenHelmSettings') || '{}');
        const params = { dataRange: settings.trainingDataRange, recencyWeighting: settings.recencyWeighting / 100.0, features: settings.features };
        trainedLeagueCode = document.getElementById('league-select').value;
        trainModels(matches, params);
    });
    
    // Setup and Data Management Listeners
    document.getElementById('fetch-results-btn').addEventListener('click', manualFetchResults);
    document.getElementById('export-data-btn').addEventListener('click', exportData);
    document.getElementById('import-data-btn').addEventListener('click', importData);
    document.getElementById('save-api-key-btn').addEventListener('click', () => {
        const key = document.getElementById('api-key-input').value;
        setApiKey(key); localStorage.setItem('geminiApiKey', key); alert('API Key saved!');
    });
    
    // Delegated Event Listener for dynamic content
    document.addEventListener('click', async (e) => {
        const unlockBtn = e.target.closest('.unlock-btn');
        const predictBtn = e.target.closest('.predict-btn, .reforecast-btn');
        const quartermasterBtn = e.target.closest('.quartermaster-btn');
        const captainBtn = e.target.closest('.captain-btn');
        const saveGuessBtn = e.target.closest('.save-guess-btn');
        const viewAnalysisBtn = e.target.closest('.view-analysis-btn');

        if (unlockBtn) {
            const fixture = allFoundFixtures.find(f => f.id === unlockBtn.dataset.fixtureId);
            if (fixture) await unlockFixture(fixture);
        } else if (predictBtn) {
            const p = await getPredictionById(predictBtn.dataset.predictionId);
            const settings = JSON.parse(localStorage.getItem('krakenHelmSettings') || '{}');
            const result = await runPrediction(p.fixture, settings);
            if(result.type === 'prediction_result') {
                p.krakenAnalysis = result.payload;
                await savePrediction(p);
                await refreshPredictionsFromDB();
                displayStatisticalReasoning(p.fixture.id, p.krakenAnalysis.officialHomeTeam, p.krakenAnalysis.officialAwayTeam, p.krakenAnalysis.reasoningStats);
            }
        } else if (quartermasterBtn) {
            const p = await getPredictionById(quartermasterBtn.dataset.predictionId);
            p.quartermasterReport = await getQuartermasterReport(p.fixture.HomeTeam, p.fixture.AwayTeam);
            await savePrediction(p); await refreshPredictionsFromDB();
        } else if (captainBtn) {
            const p = await getPredictionById(captainBtn.dataset.predictionId);
            if (!p.krakenAnalysis || !p.quartermasterReport) return;
            const stats = `H:${Math.round(p.krakenAnalysis.ensProbs[0]*100)}% D:${Math.round(p.krakenAnalysis.ensProbs[1]*100)}% A:${Math.round(p.krakenAnalysis.ensProbs[2]*100)}%`;
            const odds = { homeWin: p.fixture.HomeWinOdds, draw: p.fixture.DrawOdds, awayWin: p.fixture.AwayWinOdds };
            const lessons = []; // Simplified for local version
            p.captainReview = await getCaptainReview(p.fixture.HomeTeam, p.fixture.AwayTeam, stats, p.quartermasterReport, odds, lessons);
            await savePrediction(p); await refreshPredictionsFromDB();
        } else if (saveGuessBtn) {
            const p = await getPredictionById(saveGuessBtn.dataset.predictionId);
            const home = document.getElementById(`${saveGuessBtn.dataset.prefix}home-guess-${p.id}`)?.value;
            const away = document.getElementById(`${saveGuessBtn.dataset.prefix}away-guess-${p.id}`)?.value;
            p.userGuess = { home: parseInt(home), away: parseInt(away) };
            await savePrediction(p); await refreshPredictionsFromDB();
        } else if (viewAnalysisBtn) {
            showAnalysisModal(viewAnalysisBtn.dataset.predictionId);
        }
    });
});

window.addEventListener('beforeunload', cleanupWorker);

