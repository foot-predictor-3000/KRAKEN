// main.js (Client-Side Version)

import {
    findFixtures,
    getOddsForFixtures,
    getQuartermasterReport,
    getCaptainReview,
    setApiKey,
    getApiKey,
    fetchResultsFromSource
} from './gemini-client.js';

import {
    initDB,
    getAllMatchesFromDB,
    saveDataToDB,
    getAllPredictions,
    savePrediction,
    getPredictionById,
    clearAllPredictions
} from './db.js';

import { initWorker, trainModels, runPrediction, cleanupWorker } from './worker-handler.js';
import { setStatus, setGeminiStatus, initializeToggleListeners, renderFixtureUI, renderLedgerAndCharts } from './ui.js';
import { registerServiceWorker } from './pwa.js';

// --- Global State ---
export let allFoundFixtures = [];
export let unlockedPredictions = [];
export let trainedLeagueCode = null;

// --- State Setters ---
export function setAllFoundFixtures(fixtures) {
    allFoundFixtures = Array.isArray(fixtures) ? fixtures : [];
}
export function setUnlockedPredictions(predictions) {
    unlockedPredictions = Array.isArray(predictions) ? predictions : [];
}

// --- Helper Functions ---
function getCanonicalFixtureId(fixture) {
    if (!fixture || !fixture.HomeTeam || !fixture.AwayTeam || !fixture.MatchDate) return `invalid-${Date.now()}`;
    const home = fixture.HomeTeam.toLowerCase().replace(/[^a-z0-9]/g, '');
    const away = fixture.AwayTeam.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${home}-vs-${away}-${fixture.MatchDate}`;
}

// --- Core Application Logic ---

/**
 * Fetches and displays upcoming fixtures.
 */
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
            setAllFoundFixtures([]);
            renderFixtureUI();
            document.getElementById('fixtures-selection-area').classList.remove('hidden');
            return;
        }

        setGeminiStatus(`Spotted ${rawFixtures.length} voyages... checking odds...`, true);
        const oddsMap = await getOddsForFixtures(rawFixtures);

        const fixturesWithDetails = rawFixtures.map(f => {
            const key = `${f.HomeTeam.replace(/\s/g, '')}${f.AwayTeam.replace(/\s/g, '')}${f.MatchDate}`;
            const odds = oddsMap[key] || { HomeWinOdds: 'N/A', DrawOdds: 'N/A', AwayWinOdds: 'N/A' };
            return {
                ...f,
                id: getCanonicalFixtureId(f),
                leagueCode: leagueCode,
                HomeWinOdds: odds.HomeWinOdds,
                DrawOdds: odds.DrawOdds,
                AwayWinOdds: odds.AwayWinOdds
            };
        }).filter(f => f.HomeWinOdds !== 'N/A');

        setAllFoundFixtures(fixturesWithDetails);
        renderFixtureUI();
        setGeminiStatus(`Found ${fixturesWithDetails.length} skirmishes. Choose one to analyze.`, false);
        document.getElementById('fixtures-selection-area').classList.remove('hidden');

    } catch (error) {
        console.error('Error finding fixtures:', error);
        setGeminiStatus(`<span class="text-red-500">${error.message}</span>`, false);
    }
}

/**
 * Unlocks a fixture for analysis, saving it to the local DB.
 * @param {object} fixtureToUnlock The fixture object.
 */
async function unlockFixture(fixtureToUnlock) {
    const canonicalId = getCanonicalFixtureId(fixtureToUnlock);
    const existing = await getPredictionById(canonicalId);
    if (existing) {
        alert("Ye have already unlocked this skirmish!");
        return;
    }

    const newPrediction = {
        id: canonicalId,
        fixture: fixtureToUnlock,
        unlockedAt: new Date(),
        krakenAnalysis: null,
        quartermasterReport: null,
        captainReview: null,
        userGuess: null,
        result: null
    };

    await savePrediction(newPrediction);
    await refreshPredictionsFromDB();
}

/**
 * Fetches historical match data from the web and stores it locally.
 */
async function fetchAndStoreData() {
    const league = document.getElementById('league-select').value;
    setStatus('Sailing the digital seas for data...', true);
    
    const NUMBER_OF_SEASONS = 6;
    const now = new Date();
    let currentYear = now.getFullYear();
    let currentSeasonEndYear = (now.getMonth() >= 7) ? currentYear + 1 : currentYear;
    
    const seasonCodes = Array.from({ length: NUMBER_OF_SEASONS }, (_, i) => {
        const end = currentSeasonEndYear - i;
        const start = end - 1;
        return `${start.toString().slice(-2)}${end.toString().slice(-2)}`;
    }).reverse();

    const proxy = 'https://corsproxy.io/?';
    let allMatches = [];
    let successfulFetches = 0;

    for (const season of seasonCodes) {
        const url = `${proxy}${encodeURIComponent(`https://www.football-data.co.uk/mmz4281/${season}/${league}.csv`)}`;
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
            if (response.ok) {
                const csvText = await response.text();
                const lines = csvText.split('\n').filter(line => line.trim() !== '');
                if (lines.length > 1) {
                    const headers = lines[0].split(',').map(h => h.trim());
                    const matches = lines.slice(1).map(line => {
                        const values = line.split(',');
                        return headers.reduce((obj, header, index) => {
                            obj[header] = values[index] ? values[index].trim() : '';
                            return obj;
                        }, {});
                    });
                    allMatches.push(...matches);
                    successfulFetches++;
                }
            }
        } catch (error) {
            console.error(`Error fetching data for season ${season}:`, error);
        }
    }

    if (successfulFetches > 0) {
        await saveDataToDB(allMatches);
        setStatus(`Hoarded ${allMatches.length} match records from ${successfulFetches} seasons.`, false);
        document.getElementById('training-parchment').classList.remove('hidden');
    } else {
        setStatus(`Failed to plunder any data. Check connection, matey.`, false);
    }
}

/**
 * Manually fetches results for all unlocked, incomplete predictions.
 */
async function manualFetchResults() {
    setStatus("Checking the port for news of past skirmishes...", true);
    const predictions = await getAllPredictions();
    const incomplete = predictions.filter(p => !p.result && new Date(p.fixture.MatchDate) < new Date());

    if (incomplete.length === 0) {
        setStatus("All past predictions are already up-to-date.", false);
        return;
    }

    const predictionsBySeason = {};
    incomplete.forEach(p => {
        const date = new Date(p.fixture.MatchDate);
        const year = date.getFullYear();
        const month = date.getMonth();
        const seasonEndYear = (month >= 7) ? year + 1 : year;
        const seasonStartYear = seasonEndYear - 1;
        const season = `${(seasonStartYear % 100).toString().padStart(2, '0')}${(seasonEndYear % 100).toString().padStart(2, '0')}`;
        const key = `${p.fixture.leagueCode}-${season}`;
        if (!predictionsBySeason[key]) predictionsBySeason[key] = [];
        predictionsBySeason[key].push(p);
    });

    let updatedCount = 0;
    for (const key in predictionsBySeason) {
        const [leagueCode, season] = key.split('-');
        try {
            const resultsMap = await fetchResultsFromSource(leagueCode, season);
            for (const prediction of predictionsBySeason[key]) {
                const lookupKey = `${prediction.fixture.HomeTeam}-${prediction.fixture.AwayTeam}-${prediction.fixture.MatchDate}`;
                if (resultsMap.has(lookupKey)) {
                    prediction.result = resultsMap.get(lookupKey);
                    await savePrediction(prediction);
                    updatedCount++;
                }
            }
        } catch (error) {
            console.error(`Could not fetch results for ${leagueCode} ${season}:`, error);
        }
    }

    setStatus(`Updated ${updatedCount} prediction(s) with final results.`, false);
    await refreshPredictionsFromDB();
}


/**
 * Generates personal insights based on completed predictions.
 */
function generatePersonalInsights() {
    const completed = unlockedPredictions.filter(p => p.result);
    if (completed.length < 5) {
        document.getElementById('personal-insights-content').innerHTML = `<p class="italic">Not enough completed predictions for a report.</p>`;
        return;
    }
    
    const archetypes = {
        nnSpecialist: { total: 0, wins: 0 },
        poissonSpecialist: { total: 0, wins: 0 },
        hereAndNow: { total: 0, wins: 0 },
        longView: { total: 0, wins: 0 },
    };

    completed.forEach(p => {
        if (!p.krakenAnalysis || !p.krakenAnalysis.settingsUsed) return;
        const { settingsUsed } = p.krakenAnalysis;
        const krakenProbs = p.krakenAnalysis.ensProbs;
        const krakenPick = ['H', 'D', 'A'][krakenProbs.indexOf(Math.max(...krakenProbs))];
        const wasCorrect = krakenPick === p.result.finalOutcome;

        if (settingsUsed.nnWeight > 65) {
            archetypes.nnSpecialist.total++;
            if(wasCorrect) archetypes.nnSpecialist.wins++;
        }
        if (settingsUsed.poissonWeight > 65) {
             archetypes.poissonSpecialist.total++;
            if(wasCorrect) archetypes.poissonSpecialist.wins++;
        }
        if (settingsUsed.trainingDataRange <= 3 && settingsUsed.recencyWeighting > 70) {
             archetypes.hereAndNow.total++;
            if(wasCorrect) archetypes.hereAndNow.wins++;
        }
        if (settingsUsed.trainingDataRange === 6 && settingsUsed.recencyWeighting < 30) {
            archetypes.longView.total++;
            if(wasCorrect) archetypes.longView.wins++;
        }
    });

    const calcRate = (wins, total) => total > 2 ? Math.round((wins / total) * 100) : -1;
    const rates = {
        nnSpecialist: calcRate(archetypes.nnSpecialist.wins, archetypes.nnSpecialist.total),
        poissonSpecialist: calcRate(archetypes.poissonSpecialist.wins, archetypes.poissonSpecialist.total),
        hereAndNow: calcRate(archetypes.hereAndNow.wins, archetypes.hereAndNow.total),
        longView: calcRate(archetypes.longView.wins, archetypes.longView.total),
    };

    const sortedInsights = Object.entries(rates)
      .filter(([, rate]) => rate !== -1)
      .sort(([, a], [, b]) => b - a);

    let html = '<p class="italic text-center">No clear tactical pattern has emerged from your predictions yet.</p>';

    if (sortedInsights.length > 0) {
        const best = sortedInsights[0];
        const names = {
            nnSpecialist: "The Specialist (Pattern Scout)",
            poissonSpecialist: "The Specialist (Goal Scorer)",
            hereAndNow: "The 'Here and Now' Tactician",
            longView: "The 'Long View' Historian",
        };
        html = `<p class="text-center"><span class="font-bold">Your most successful tactic is</span><br><span class="font-pirata text-2xl text-blue-800">${names[best[0]]}</span><br><span class="font-bold">with a ${best[1]}% success rate.</span></p>`;
    }
    
    document.getElementById('personal-insights-content').innerHTML = html;
}

/**
 * Exports user data to a JSON file.
 */
async function exportData() {
    const data = {
        predictions: await getAllPredictions(),
        apiKey: getApiKey(),
        settings: JSON.parse(localStorage.getItem('krakenHelmSettings') || '{}'),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `captain-turfbeard-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    alert('Your data has been exported!');
}

/**
 * Imports user data from a JSON file.
 */
async function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        try {
            const data = JSON.parse(text);
            if (!data.predictions || !Array.isArray(data.predictions)) {
                throw new Error('Invalid backup file: "predictions" array not found.');
            }
            if (confirm(`This will overwrite all current data with the backup file's content. Are you sure you wish to proceed?`)) {
                await clearAllPredictions();
                for (const prediction of data.predictions) {
                    await savePrediction(prediction);
                }
                if (data.apiKey) {
                    setApiKey(data.apiKey);
                    document.getElementById('api-key-input').value = data.apiKey;
                    localStorage.setItem('geminiApiKey', data.apiKey);
                }
                if (data.settings) {
                    localStorage.setItem('krakenHelmSettings', JSON.stringify(data.settings));
                }
                alert('Data successfully imported!');
                await refreshPredictionsFromDB();
            }
        } catch (error) {
            console.error('Import failed:', error);
            alert(`Import failed: ${error.message}`);
        }
    };
    input.click();
}


/**
 * Reloads all predictions from the DB and re-renders the UI.
 */
async function refreshPredictionsFromDB() {
    const predictions = await getAllPredictions();
    setUnlockedPredictions(predictions);
    renderFixtureUI();
    renderLedgerAndCharts(predictions);
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    registerServiceWorker();
    initializeToggleListeners();
    await initDB();
    initWorker();
    setStatus('Choose yer ocean and plunder the depths.', false);

    // Load saved API key and settings
    const savedApiKey = localStorage.getItem('geminiApiKey');
    if (savedApiKey) {
        setApiKey(savedApiKey);
        document.getElementById('api-key-input').value = savedApiKey;
    }

    await refreshPredictionsFromDB();

    // Setup Modals
    const setupModal = (modalId, openBtnId, closeBtnId) => {
        const modal = document.getElementById(modalId);
        const openBtn = document.getElementById(openBtnId);
        const closeBtn = document.getElementById(closeBtnId);
        if (modal && openBtn && closeBtn) {
            openBtn.addEventListener('click', () => modal.classList.remove('hidden'));
            closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
            modal.addEventListener('click', (e) => e.target === modal && modal.classList.add('hidden'));
        }
    };
    setupModal('log-book-section', 'log-book-btn', 'close-log-book-btn');
    setupModal('helm-modal', 'open-helm-btn', 'close-helm-btn');

    // Tab functionality
    document.querySelectorAll('.tab-btn').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            if(target === 'charts') generatePersonalInsights();
            document.querySelectorAll('.tab-btn').forEach(t => t.classList.toggle('bg-amber-800', t.dataset.tab === target));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== `tab-panel-${target}`));
        });
    });

    // Event Listeners
    document.getElementById('fetch-data-btn').addEventListener('click', fetchAndStoreData);
    document.getElementById('find-fixtures-btn').addEventListener('click', findAndDisplayFixtures);
    document.getElementById('train-models-btn').addEventListener('click', async () => {
        const matches = await getAllMatchesFromDB();
        if (matches.length === 0) return setStatus('No data to train on!', false);
        const helmSettings = JSON.parse(localStorage.getItem('krakenHelmSettings') || '{}');
        const params = {
            dataRange: helmSettings.trainingDataRange ?? 6,
            recencyWeighting: (helmSettings.recencyWeighting ?? 50) / 100.0,
            features: helmSettings.features ?? { form: true, h2h: true, elo: true, offense: true, defense: true, congestion: true },
        };
        trainedLeagueCode = document.getElementById('league-select').value;
        trainModels(matches, params);
    });

    // New button listeners
    document.getElementById('fetch-results-btn').addEventListener('click', manualFetchResults);
    document.getElementById('export-data-btn').addEventListener('click', exportData);
    document.getElementById('import-data-btn').addEventListener('click', importData);
    document.getElementById('save-api-key-btn').addEventListener('click', () => {
        const key = document.getElementById('api-key-input').value;
        if (key) {
            setApiKey(key);
            localStorage.setItem('geminiApiKey', key);
            alert('API Key saved!');
        } else {
            alert('Please enter an API key.');
        }
    });

    // Delegated event listener for dynamic buttons
    document.addEventListener('click', async (e) => {
        const unlockButton = e.target.closest('.unlock-btn');
        const predictButton = e.target.closest('.predict-btn');
        const quartermasterButton = e.target.closest('.quartermaster-btn');
        const captainButton = e.target.closest('.captain-btn');
        const saveGuessButton = e.target.closest('.save-guess-btn');

        if (unlockButton) {
            const fixtureId = unlockButton.dataset.fixtureId;
            const fixture = allFoundFixtures.find(f => f.id === fixtureId);
            if (fixture) await unlockFixture(fixture);
        } else if (predictButton) {
            const predictionId = predictButton.dataset.predictionId;
            const prediction = await getPredictionById(predictionId);
            if (!prediction) return;
            const helmSettings = JSON.parse(localStorage.getItem('krakenHelmSettings') || '{}');
            const result = await runPrediction(prediction.fixture, helmSettings);
            if (result.type === 'prediction_result') {
                prediction.krakenAnalysis = result.payload;
                await savePrediction(prediction);
                await refreshPredictionsFromDB();
            } else {
                 document.getElementById(`prediction-${prediction.id}`).innerHTML = `<p class="text-red-500">${result.payload}</p>`;
            }
        } else if (quartermasterButton) {
            const predictionId = quartermasterButton.dataset.predictionId;
            const prediction = await getPredictionById(predictionId);
            if (!prediction) return;
            const report = await getQuartermasterReport(prediction.fixture.HomeTeam, prediction.fixture.AwayTeam);
            prediction.quartermasterReport = report;
            await savePrediction(prediction);
            await refreshPredictionsFromDB();
        } else if (captainButton) {
            const predictionId = captainButton.dataset.predictionId;
            const prediction = await getPredictionById(predictionId);
            if (!prediction || !prediction.krakenAnalysis || !prediction.quartermasterReport) return;
            const krakenProbs = prediction.krakenAnalysis.ensProbs;
            const statsString = `Home Win: ${Math.round(krakenProbs[0]*100)}%, Draw: ${Math.round(krakenProbs[1]*100)}%, Away Win: ${Math.round(krakenProbs[2]*100)}%`;
            const bookmakerOdds = { homeWin: prediction.fixture.HomeWinOdds, draw: prediction.fixture.DrawOdds, awayWin: prediction.fixture.AwayWinOdds };
            const recentLessons = unlockedPredictions.filter(p=>p.result).slice(0,3).map(p => {
                const winner = p.result.finalOutcome === 'H' ? p.fixture.HomeTeam : p.result.finalOutcome === 'A' ? p.fixture.AwayTeam : 'Draw';
                return `The match ${p.fixture.HomeTeam} vs ${p.fixture.AwayTeam} ended ${p.result.homeScore}-${p.result.awayScore} (${winner}). Your guess was ${p.userGuess?.home}-${p.userGuess?.away}.`;
            });
            const review = await getCaptainReview(prediction.fixture.HomeTeam, prediction.fixture.AwayTeam, statsString, prediction.quartermasterReport, bookmakerOdds, recentLessons);
            prediction.captainReview = review;
            await savePrediction(prediction);
            await refreshPredictionsFromDB();
        } else if (saveGuessButton) {
            const predictionId = saveGuessButton.dataset.predictionId;
            const home = document.getElementById(`home-guess-${predictionId}`)?.value;
            const away = document.getElementById(`away-guess-${predictionId}`)?.value;
            if (home && away) {
                const prediction = await getPredictionById(predictionId);
                if(prediction) {
                    prediction.userGuess = { home: parseInt(home), away: parseInt(away) };
                    await savePrediction(prediction);
                    await refreshPredictionsFromDB();
                }
            }
        }
    });
});

window.addEventListener('beforeunload', cleanupWorker);
