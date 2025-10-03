// main.js (New Version - Fully Local with Gemini API)

import {
    findFixtures,
    getOddsForFixtures,
    getQuartermasterReport,
    getCaptainReview
} from './gemini-client.js';

import {
    initDB,
    getAllMatchesFromDB,
    saveDataToDB,
    savePrediction,
    updatePrediction,
    getAllPredictions,
    getPredictionsNeedingResults,
    getUpcomingPredictions,
    getCompletedPredictions,
    saveSetting,
    getSetting,
    getAllSettings,
    saveLesson,
    getRecentLessons,
    clearLessons,
    exportAllData,
    importData,
    clearAllData
} from './db.js';

import { initWorker, trainModels, runPrediction, cleanupWorker } from './worker-handler.js';
import { setStatus, initializeToggleListeners, showAnalysisModal, renderFixtureUI, renderLedger } from './ui.js';

// --- Global State Management ---
export let allFoundFixtures = [];
export let unlockedPredictions = [];
export let trainedLeagueCode = null;

export function setAllFoundFixtures(fixtures) {
    if (Array.isArray(fixtures)) {
        allFoundFixtures = fixtures;
        console.log(`Set ${fixtures.length} found fixtures`);
    } else {
        console.warn('setAllFoundFixtures called with non-array:', fixtures);
        allFoundFixtures = [];
    }
}

export function setUnlockedPredictions(predictions) {
    if (Array.isArray(predictions)) {
        unlockedPredictions = predictions;
        console.log(`Set ${predictions.length} unlocked predictions`);
    } else {
        console.warn('setUnlockedPredictions called with non-array:', predictions);
        unlockedPredictions = [];
    }
}

// Event listener management
const eventListeners = new Map();

function addManagedEventListener(element, event, handler) {
    if (!element) return;
    
    const key = `${element.id || 'unknown'}_${event}`;
    if (eventListeners.has(key)) {
        const oldHandler = eventListeners.get(key);
        element.removeEventListener(event, oldHandler);
    }
    
    element.addEventListener(event, handler);
    eventListeners.set(key, handler);
}

// Safe DOM helper functions
function safeGetElement(id) {
    const element = document.getElementById(id);
    if (!element) {
        console.warn(`Element with id '${id}' not found`);
    }
    return element;
}

function safeToggleClass(element, className, condition) {
    if (element) {
        element.classList.toggle(className, condition);
    }
}

// --- API Key Management ---
let cachedApiKey = null;

async function getApiKey() {
    if (cachedApiKey) return cachedApiKey;
    cachedApiKey = await getSetting('gemini_api_key');
    return cachedApiKey;
}

async function setApiKey(key) {
    await saveSetting('gemini_api_key', key);
    cachedApiKey = key;
}

function showApiKeyModal() {
    const modal = safeGetElement('api-key-modal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

function hideApiKeyModal() {
    const modal = safeGetElement('api-key-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

async function validateAndSaveApiKey() {
    const input = safeGetElement('api-key-input');
    const status = safeGetElement('api-key-status');
    
    if (!input || !status) return;
    
    const key = input.value.trim();
    
    if (!key) {
        status.textContent = 'Please enter an API key';
        status.className = 'text-red-600 text-sm mt-2';
        return;
    }
    
    status.textContent = 'Testing API key...';
    status.className = 'text-blue-600 text-sm mt-2';
    
    try {
        // Test the API key with a simple call
        await findFixtures('Premier League', key, true);
        
        await setApiKey(key);
        status.textContent = 'API key saved successfully!';
        status.className = 'text-green-600 text-sm mt-2';
        
        setTimeout(() => {
            hideApiKeyModal();
            status.textContent = '';
        }, 1500);
    } catch (error) {
        console.error('API key validation failed:', error);
        status.textContent = `Invalid API key: ${error.message}`;
        status.className = 'text-red-600 text-sm mt-2';
    }
}

// --- Data Fetching & Processing ---
function getSeasonCodes() {
    const NUMBER_OF_SEASONS = 6;
    const seasonCodes = [];
    const now = new Date();
    let currentYear = now.getFullYear();
    let currentSeasonEndYear = (now.getMonth() >= 7) ? currentYear + 1 : currentYear;
    const formatYear = (y) => y.toString().slice(-2);
    for (let i = 0; i < NUMBER_OF_SEASONS; i++) {
        const seasonEndYear = currentSeasonEndYear - i;
        const seasonStartYear = seasonEndYear - 1;
        seasonCodes.push(formatYear(seasonStartYear) + formatYear(seasonEndYear));
    }
    return seasonCodes.reverse();
}

function parseCSV(text) {
    if (!text || typeof text !== 'string') {
        console.warn('Invalid CSV text provided');
        return [];
    }
    
    try {
        const lines = text.split('\n').filter(line => line.trim() !== '');
        if (lines.length < 2) return [];
        
        const headers = lines[0].replace(/^\uFEFF/, '').split(',').map(h => h.trim());
        return lines.slice(1).map(line => {
            const values = line.split(',');
            const match = {};
            headers.forEach((header, i) => {
                match[header] = values[i] ? values[i].trim() : '';
            });
            return match;
        });
    } catch (error) {
        console.error('Error parsing CSV:', error);
        return [];
    }
}

async function fetchAndStoreData() {
    const fetchDataBtn = safeGetElement('fetch-data-btn');
    const leagueSelect = safeGetElement('league-select');
    const trainingParchment = safeGetElement('training-parchment');
    const trainModelsBtn = safeGetElement('train-models-btn');
    const trainingStatusArea = safeGetElement('training-status-area');
    
    if (!leagueSelect) {
        console.error('League select element not found');
        return;
    }
    
    setStatus('Sailing the digital seas for data...', true);
    safeToggleClass(trainingParchment, 'hidden', true);
    
    if (fetchDataBtn) {
        fetchDataBtn.disabled = true;
        fetchDataBtn.classList.add('svg-button-disabled');
    }
    
    const league = leagueSelect.value;
    const seasonCodes = getSeasonCodes();
    const proxy = 'https://corsproxy.io/?';
    let allMatches = [], successfulFetches = 0;

    for (const season of seasonCodes) {
        const url = `${proxy}${encodeURIComponent(`https://www.football-data.co.uk/mmz4281/${season}/${league}.csv`)}`;
        try {
            const response = await fetch(url, { 
                signal: AbortSignal.timeout(10000)
            });
            if (response.ok) {
                const csvText = await response.text();
                const matches = parseCSV(csvText);
                if (matches.length > 0) {
                    allMatches.push(...matches);
                    successfulFetches++;
                }
            } else {
                console.warn(`Could not fetch data for season ${season}. Status: ${response.status}`);
            }
        } catch (error) {
            console.error(`Error fetching data for season ${season}:`, error);
        }
    }
    
    if (fetchDataBtn) {
        fetchDataBtn.disabled = false;
        fetchDataBtn.classList.remove('svg-button-disabled');
    }
    
    if (successfulFetches === 0) {
        setStatus(`Failed to plunder any data. Check connection, matey.`, false);
        return;
    }
    
    try {
        await saveDataToDB(allMatches);
        setStatus(`Hoarded ${allMatches.length} match records from ${successfulFetches} seasons.`, false);
        
        safeToggleClass(trainingParchment, 'hidden', false);
        if (trainModelsBtn) {
            trainModelsBtn.disabled = false;
            trainModelsBtn.classList.remove('svg-button-disabled');
        }
        if (trainingStatusArea) {
            trainingStatusArea.textContent = 'The Kraken needs training on this new loot.';
        }
    } catch (error) {
        console.error('Error saving data to DB:', error);
        setStatus('Failed to store the plundered data!', false);
    }
}

// --- Fixture Finding with Gemini ---
async function findFixturesWithGemini(leagueName, leagueCode, testMode = false) {
    const apiKey = await getApiKey();
    if (!apiKey) {
        alert('Please set your Gemini API key in Settings first!');
        showApiKeyModal();
        return;
    }

    try {
        const geminiStatusArea = safeGetElement('gemini-status-area');
        const fixturesSelectionArea = safeGetElement('fixtures-selection-area');
        
        if (geminiStatusArea) {
            geminiStatusArea.innerHTML = '<div class="flex items-center"><dotlottie-wc src="https://lottie.host/19109b73-f99a-4a89-a48c-d5b90bf22b22/tlVX1kmiPt.lottie" background="transparent" speed="1" style="width: 40px; height: 40px;" loop autoplay></dotlottie-wc><p class="ml-2">Scanning the horizon for fixtures...</p></div>';
        }
        safeToggleClass(fixturesSelectionArea, 'hidden', true);

        // Step 1: Get fixtures
        const rawFixtures = await findFixtures(leagueName, apiKey, testMode);
        
        if (rawFixtures.length === 0) {
            if (geminiStatusArea) {
                geminiStatusArea.innerHTML = '<p class="text-gray-600">No upcoming skirmishes found for this league.</p>';
            }
            setAllFoundFixtures([]);
            renderFixtureUI();
            safeToggleClass(fixturesSelectionArea, 'hidden', false);
            return;
        }

        if (geminiStatusArea) {
            geminiStatusArea.innerHTML = `<div class="flex items-center"><dotlottie-wc src="https://lottie.host/19109b73-f99a-4a89-a48c-d5b90bf22b22/tlVX1kmiPt.lottie" background="transparent" speed="1" style="width: 40px; height: 40px;" loop autoplay></dotlottie-wc><p class="ml-2">Spotted ${rawFixtures.length} voyages... now checking the bookmakers' odds...</p></div>`;
        }

        // Step 2: Get odds
        const oddsMap = await getOddsForFixtures(rawFixtures, apiKey);

        // Step 3: Combine and filter
        const fixturesWithOdds = rawFixtures.map(f => {
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
        });
        
        const validFixtures = fixturesWithOdds.filter(f => 
            f.HomeWinOdds !== 'N/A' && f.DrawOdds !== 'N/A' && f.AwayWinOdds !== 'N/A'
        );

        const filteredCount = fixturesWithOdds.length - validFixtures.length;
        if (filteredCount > 0) {
            console.log(`Filtered out ${filteredCount} fixtures missing odds.`);
        }

        console.log('Found valid fixtures with odds:', validFixtures);

        setAllFoundFixtures(validFixtures);
        renderFixtureUI();

        if (geminiStatusArea) {
            geminiStatusArea.innerHTML = `<p class="text-gray-600">Found ${validFixtures.length} skirmishes. Choose which to analyze.</p>`;
        }
        safeToggleClass(fixturesSelectionArea, 'hidden', false);

    } catch (error) {
        console.error('Fixture finding error:', error);
        const geminiStatusArea = safeGetElement('gemini-status-area');
        if (geminiStatusArea) {
            geminiStatusArea.innerHTML = `<p class="text-red-500">The spyglass is cracked! ${error.message}</p>`;
        }
    }
}

// --- Fixture ID Generation (matching backend) ---
function standardizeTeamName(teamName) {
    if (!teamName) return "";
    
    const aliases = {
        "Wolverhampton Wanderers": "Wolves",
        "Man Utd": "Man United",
        "Manchester United": "Man United",
        "Tottenham Hotspur": "Tottenham",
        "West Bromwich Albion": "West Brom",
        "Nott'm Forest": "Nottingham Forest",
        "Nottingham Forest": "Nottingham Forest",
        "Sheffield Wednesday": "Sheff Wed",
        "Queens Park Rangers": "QPR",
        "Brighton & Hove Albion": "Brighton",
    };

    if (aliases[teamName]) return aliases[teamName];
    const standardValues = new Set(Object.values(aliases));
    if (standardValues.has(teamName)) return teamName;
    return teamName;
}

const getCanonicalFixtureId = (fixture) => {
    if (!fixture || !fixture.HomeTeam || !fixture.AwayTeam || !fixture.MatchDate) {
        console.warn('Invalid fixture for ID generation:', fixture);
        return `invalid-fixture-${Date.now()}`;
    }
    
    const home = standardizeTeamName(fixture.HomeTeam).toLowerCase().replace(/[^a-z0-9]/g, '');
    const away = standardizeTeamName(fixture.AwayTeam).toLowerCase().replace(/[^a-z0-9]/g, '');
    
    const canonicalId = `${home}-vs-${away}-${fixture.MatchDate}`;
    console.log(`Generated canonical ID: ${canonicalId} for ${fixture.HomeTeam} vs ${fixture.AwayTeam}`);
    return canonicalId;
};

// --- Prediction Management ---
async function unlockFixture(fixture) {
    const canonicalId = getCanonicalFixtureId(fixture);
    
    console.log('Attempting to unlock fixture with ID:', canonicalId);
    console.log('Current unlocked predictions:', unlockedPredictions.map(p => p.fixture.id));
    
    if (unlockedPredictions.some(p => p.fixture.id === canonicalId)) {
        alert("Ye have already unlocked this skirmish!");
        return;
    }
    
    try {
        const fixtureToStore = {
            ...fixture,
            id: canonicalId,
            HomeWinOdds: fixture.HomeWinOdds || 'N/A',
            DrawOdds: fixture.DrawOdds || 'N/A', 
            AwayWinOdds: fixture.AwayWinOdds || 'N/A'
        };
        
        const predictionId = await savePrediction({
            fixture: fixtureToStore,
            unlockedAt: new Date(),
            result: null
        });
        
        console.log('Fixture unlocked with prediction ID:', predictionId);
        await loadPredictions();
    } catch (error) {
        console.error("Error unlocking fixture:", error);
        alert("There was a problem unlocking the fixture. Please try again.");
    }
}

async function saveUserGuess(predictionId, homeScore, awayScore) {
    try {
        await updatePrediction(predictionId, { 
            userGuess: { 
                home: parseInt(homeScore, 10), 
                away: parseInt(awayScore, 10) 
            } 
        });
        console.log("User guess saved!");
        await loadPredictions();
    } catch (error) { 
        console.error("Error saving user guess:", error); 
        alert("Couldn't save yer guess, try again matey!"); 
    }
}

// --- Quartermaster and Captain Functions ---
async function getQuartermasterReportLocal(homeTeam, awayTeam, index, predictionId) {
    const apiKey = await getApiKey();
    if (!apiKey) {
        alert('Please set your Gemini API key in Settings first!');
        return;
    }

    try {
        const reportSection = safeGetElement(`quartermaster-report-section-${index}`);
        if (reportSection) {
            reportSection.innerHTML = `<div class="flex items-center text-sm text-gray-500"><dotlottie-wc src="https://lottie.host/19109b73-f99a-4a89-a48c-d5b90bf22b22/tlVX1kmiPt.lottie" background="transparent" speed="1" style="width: 40px; height: 40px;" loop autoplay></dotlottie-wc><p class="ml-2">The Quartermaster is gathering intel...</p></div>`;
        }
        
        const report = await getQuartermasterReport(homeTeam, awayTeam, apiKey);
        console.log("Quartermaster Raw Data Received:", report);

        await updatePrediction(predictionId, { 
            quartermasterReport: report
        });
        
        await loadPredictions();
    } catch(error) { 
        console.error("Quartermaster Error:", error); 
        const reportSection = safeGetElement(`quartermaster-report-section-${index}`);
        if (reportSection) {
            reportSection.innerHTML = `<p class="text-red-500">Oh dear! ${error.message}</p>`;
        }
    }
}

async function getCaptainReviewLocal(homeTeam, awayTeam, index, predictionId, currentPrediction) {
    const apiKey = await getApiKey();
    if (!apiKey) {
        alert('Please set your Gemini API key in Settings first!');
        return;
    }

    try {
        const captainSection = safeGetElement(`captain-review-section-${index}`);
        if (captainSection) {
            captainSection.innerHTML = `<div class="flex items-center text-sm text-gray-500"><dotlottie-wc src="https://lottie.host/19109b73-f99a-4a89-a48c-d5b90bf22b22/tlVX1kmiPt.lottie" background="transparent" speed="1" style="width: 40px; height: 40px;" loop autoplay></dotlottie-wc><p class="ml-2">The Captain is making his decision...</p></div>`;
        }
        
        if (!currentPrediction?.krakenAnalysis || !currentPrediction?.quartermasterReport) { 
            if (captainSection) {
                captainSection.innerHTML = "<p class='text-red-500'>The Captain needs the Kraken's forecast and the Quartermaster's report first.</p>";
            }
            return; 
        }
        
        const krakenProbs = currentPrediction.krakenAnalysis.ensProbs;
        const statsString = `Home Win: ${Math.round(krakenProbs[0]*100)}%, Draw: ${Math.round(krakenProbs[1]*100)}%, Away Win: ${Math.round(krakenProbs[2]*100)}%`;
        
        const bookmakerOdds = {
            homeWin: currentPrediction.fixture.HomeWinOdds || 'N/A',
            draw: currentPrediction.fixture.DrawOdds || 'N/A',
            awayWin: currentPrediction.fixture.AwayWinOdds || 'N/A'
        };

        // Get recent lessons for context
        const recentLessons = await getRecentLessons(3);

        const review = await getCaptainReview(
            homeTeam, 
            awayTeam, 
            statsString, 
            currentPrediction.quartermasterReport,
            bookmakerOdds,
            apiKey,
            recentLessons
        );
        
        await updatePrediction(predictionId, { captainReview: review });
        await loadPredictions();
    } catch (error) { 
        console.error("Captain's Review Error:", error); 
        const captainSection = safeGetElement(`captain-review-section-${index}`);
        if (captainSection) {
            captainSection.innerHTML = `<p class="text-red-500">Shiver me timbers! ${error.message}</p>`;
        }
    }
}

// --- Manual Result Fetching ---
async function fetchMatchResults() {
    const btn = safeGetElement('fetch-results-btn');
    const status = safeGetElement('fetch-results-status');
    
    if (btn) btn.disabled = true;
    if (status) status.innerHTML = '<div class="flex items-center text-sm"><dotlottie-wc src="https://lottie.host/19109b73-f99a-4a89-a48c-d5b90bf22b22/tlVX1kmiPt.lottie" background="transparent" speed="1" style="width: 30px; height: 30px;" loop autoplay></dotlottie-wc><p class="ml-2">Fetching results from the archives...</p></div>';
    
    try {
        const predictionsNeedingResults = await getPredictionsNeedingResults();
        
        if (predictionsNeedingResults.length === 0) {
            if (status) status.innerHTML = '<p class="text-gray-600">No past matches need results.</p>';
            if (btn) btn.disabled = false;
            return;
        }

        console.log(`Found ${predictionsNeedingResults.length} predictions needing results`);

        // Group by season and league
        const predictionsBySeason = {};
        predictionsNeedingResults.forEach(p => {
            if (!p.fixture || !p.fixture.MatchDate || !p.fixture.leagueCode) {
                console.warn('Skipping prediction with missing data:', p);
                return;
            }

            const matchDate = new Date(p.fixture.MatchDate);
            const season = getSeasonCodeForDate(matchDate);
            const leagueCode = p.fixture.leagueCode;
            const seasonKey = `${season}-${leagueCode}`;

            if (!predictionsBySeason[seasonKey]) {
                predictionsBySeason[seasonKey] = [];
            }
            predictionsBySeason[seasonKey].push(p);
        });

        let totalUpdated = 0;

        for (const seasonKey in predictionsBySeason) {
            const [season, leagueCode] = seasonKey.split('-');
            const url = `https://corsproxy.io/?${encodeURIComponent(`https://www.football-data.co.uk/mmz4281/${season}/${leagueCode}.csv`)}`;

            try {
                console.log(`Fetching results from ${url}`);
                const response = await fetch(url, { timeout: 15000 });
                const csvText = await response.text();
                const results = parseCSV(csvText);

                const resultsMap = new Map();
                results.forEach(result => {
                    const resultDate = parseFootballDataDate(result.Date);
                    const homeTeam = standardizeTeamName(result.HomeTeam);
                    const awayTeam = standardizeTeamName(result.AwayTeam);
                    if (homeTeam && awayTeam && resultDate) {
                        resultsMap.set(`${homeTeam}-${awayTeam}-${resultDate}`, result);
                    }
                });

                for (const prediction of predictionsBySeason[seasonKey]) {
                    const homeTeam = standardizeTeamName(prediction.fixture.HomeTeam);
                    const awayTeam = standardizeTeamName(prediction.fixture.AwayTeam);
                    const lookupKey = `${homeTeam}-${awayTeam}-${prediction.fixture.MatchDate}`;
                    const result = resultsMap.get(lookupKey);

                    if (result && result.FTHG && result.FTAG && result.FTR) {
                        console.log(`✅ MATCH FOUND for ${lookupKey}: ${result.FTHG}-${result.FTAG}`);
                        const resultData = {
                            homeScore: parseInt(result.FTHG, 10),
                            awayScore: parseInt(result.FTAG, 10),
                            finalOutcome: result.FTR
                        };

                        if (!isNaN(resultData.homeScore) && !isNaN(resultData.awayScore)) {
                            await updatePrediction(prediction.id, { result: resultData });
                            totalUpdated++;
                        }
                    }
                }
            } catch (error) {
                console.error(`Failed to fetch results for season ${season}:`, error);
            }
        }

        if (status) {
            status.innerHTML = `<p class="text-green-600">Updated ${totalUpdated} match result(s)!</p>`;
        }
        
        await loadPredictions();
    } catch (error) {
        console.error('Error fetching results:', error);
        if (status) {
            status.innerHTML = `<p class="text-red-500">Failed to fetch results: ${error.message}</p>`;
        }
    } finally {
        if (btn) btn.disabled = false;
    }
}

function getSeasonCodeForDate(date) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const seasonEndYear = (month >= 7) ? year + 1 : year;
    const seasonStartYear = seasonEndYear - 1;
    return `${seasonStartYear.toString().slice(-2)}${seasonEndYear.toString().slice(-2)}`;
}

function parseFootballDataDate(dateStr) {
    if (!dateStr) return null;
    
    try {
        const parts = dateStr.split('/');
        if (parts.length !== 3) return null;
        let [day, month, year] = parts;
        if (year.length === 2) {
            year = parseInt(year, 10) < 50 ? `20${year}` : `19${year}`;
        }
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    } catch (error) {
        console.error('Error parsing date:', dateStr, error);
        return null;
    }
}

// --- Personal Analysis and Lessons ---
async function analyzePersonalPerformance() {
    const btn = safeGetElement('analyze-performance-btn');
    const status = safeGetElement('analysis-status');
    
    if (btn) btn.disabled = true;
    if (status) status.innerHTML = '<p class="text-blue-600">Analyzing yer logbook...</p>';

    try {
        const completed = await getCompletedPredictions();
        
        if (completed.length < 5) {
            if (status) {
                status.innerHTML = '<p class="text-gray-600">Not enough completed predictions to analyze (need at least 5).</p>';
            }
            return;
        }

        // Calculate statistics
        const stats = calculatePersonalStats(completed);
        
        // Generate lessons with Gemini
        const apiKey = await getApiKey();
        if (!apiKey) {
            if (status) {
                status.innerHTML = '<p class="text-red-500">API key required to generate lessons.</p>';
            }
            return;
        }

        const lessons = await generatePersonalLessons(stats, apiKey);
        
        // Save lessons to database
        await clearLessons();
        for (const lesson of lessons) {
            await saveLesson(lesson);
        }

        if (status) {
            status.innerHTML = '<p class="text-green-600">Analysis complete! New lessons learned.</p>';
        }

        // Refresh UI
        await loadPredictions();
    } catch (error) {
        console.error('Error analyzing performance:', error);
        if (status) {
            status.innerHTML = `<p class="text-red-500">Analysis failed: ${error.message}</p>`;
        }
    } finally {
        if (btn) btn.disabled = false;
    }
}

function calculatePersonalStats(predictions) {
    const stats = {
        totalCompleted: 0,
        kraken: { highConfidenceTotal: 0, highConfidenceHits: 0 },
        captainVsKraken: { disputes: 0, captainWins: 0 },
        agreement: { allAgreeTotal: 0, allAgreeWins: 0 },
        elo: { krakenPicksUnderdog: 0, krakenUnderdogWins: 0 },
        archetypes: {
            nnSpecialist: { total: 0, wins: 0 },
            lrSpecialist: { total: 0, wins: 0 },
            poissonSpecialist: { total: 0, wins: 0 },
            historian: { total: 0, wins: 0 },
            modernist: { total: 0, wins: 0 },
            trendChaser: { total: 0, wins: 0 },
            hereAndNow: { total: 0, wins: 0 },
            longView: { total: 0, wins: 0 }
        }
    };

    predictions.forEach(p => {
        if (!p.krakenAnalysis || !p.captainReview || !p.fixture || !p.result) return;

        stats.totalCompleted++;
        const krakenProbs = p.krakenAnalysis.ensProbs || [];
        const krakenPickIndex = krakenProbs.indexOf(Math.max(...krakenProbs));
        const krakenPick = ['H', 'D', 'A'][krakenPickIndex];
        const wasKrakenCorrect = krakenPick === p.result.finalOutcome;

        // Archetype tracking - ALL 8 archetypes
        const { settingsUsed } = p.krakenAnalysis;
        if (settingsUsed) {
            // Simple archetypes (specialist in one model)
            if (settingsUsed.nnWeight > 65) {
                stats.archetypes.nnSpecialist.total++;
                if (wasKrakenCorrect) stats.archetypes.nnSpecialist.wins++;
            }
            if (settingsUsed.lrWeight > 65) {
                stats.archetypes.lrSpecialist.total++;
                if (wasKrakenCorrect) stats.archetypes.lrSpecialist.wins++;
            }
            if (settingsUsed.poissonWeight > 65) {
                stats.archetypes.poissonSpecialist.total++;
                if (wasKrakenCorrect) stats.archetypes.poissonSpecialist.wins++;
            }
            
            // Data range archetypes
            if (settingsUsed.trainingDataRange === 6) {
                stats.archetypes.historian.total++;
                if (wasKrakenCorrect) stats.archetypes.historian.wins++;
            } else if (settingsUsed.trainingDataRange <= 3) {
                stats.archetypes.modernist.total++;
                if (wasKrakenCorrect) stats.archetypes.modernist.wins++;
            }
            
            // Recency archetype
            if (settingsUsed.recencyWeighting > 70) {
                stats.archetypes.trendChaser.total++;
                if (wasKrakenCorrect) stats.archetypes.trendChaser.wins++;
            }
            
            // Combination archetypes
            if (settingsUsed.trainingDataRange <= 3 && settingsUsed.recencyWeighting > 70) {
                stats.archetypes.hereAndNow.total++;
                if (wasKrakenCorrect) stats.archetypes.hereAndNow.wins++;
            }
            if (settingsUsed.trainingDataRange === 6 && settingsUsed.recencyWeighting < 30) {
                stats.archetypes.longView.total++;
                if (wasKrakenCorrect) stats.archetypes.longView.wins++;
            }
        }

        // High confidence tracking
        if (Math.max(...krakenProbs) > 0.65) {
            stats.kraken.highConfidenceTotal++;
            if (wasKrakenCorrect) stats.kraken.highConfidenceHits++;
        }

        // Captain vs Kraken
        const captainProbs = p.captainReview.finalProbabilities || {};
        const captainMaxProb = Math.max(captainProbs.home || 0, captainProbs.draw || 0, captainProbs.away || 0);
        let captainPick;
        if (captainMaxProb === captainProbs.home) captainPick = 'H';
        else if (captainMaxProb === captainProbs.draw) captainPick = 'D';
        else captainPick = 'A';

        if (krakenPick !== captainPick) {
            stats.captainVsKraken.disputes++;
            if (captainPick === p.result.finalOutcome) {
                stats.captainVsKraken.captainWins++;
            }
        }

        // Agreement tracking
        const odds = [parseFloat(p.fixture.HomeWinOdds), parseFloat(p.fixture.DrawOdds), parseFloat(p.fixture.AwayWinOdds)];
        const validOdds = odds.filter(o => !isNaN(o));
        if (validOdds.length > 0) {
            const minOdd = Math.min(...validOdds);
            const bookiePick = ['H', 'D', 'A'][odds.indexOf(minOdd)];

            if (bookiePick === krakenPick && krakenPick === captainPick) {
                stats.agreement.allAgreeTotal++;
                if (bookiePick === p.result.finalOutcome) {
                    stats.agreement.allAgreeWins++;
                }
            }
        }

        // Elo underdog tracking
        const { reasoningStats } = p.krakenAnalysis;
        if (reasoningStats && reasoningStats.homeElo && reasoningStats.awayElo) {
            const eloFavorite = reasoningStats.homeElo >= reasoningStats.awayElo ? 'H' : 'A';
            if (krakenPick !== 'D' && krakenPick !== eloFavorite) {
                stats.elo.krakenPicksUnderdog++;
                if (wasKrakenCorrect) stats.elo.krakenUnderdogWins++;
            }
        }
    });

    return stats;
}

// --- Lightweight Personal Insights Display (just stats, no lesson generation) ---
async function displayPersonalInsights() {
    try {
        const completed = await getCompletedPredictions();
        
        if (completed.length < 5) {
            return {
                error: `Not enough completed predictions to generate personal insights. Found ${completed.length}, need at least 5.`
            };
        }

        const stats = calculatePersonalStats(completed);
        const calcRate = (wins, total) => total > 0 ? (wins / total) : -1;

        return {
            nnSpecialist: calcRate(stats.archetypes.nnSpecialist.wins, stats.archetypes.nnSpecialist.total),
            lrSpecialist: calcRate(stats.archetypes.lrSpecialist.wins, stats.archetypes.lrSpecialist.total),
            poissonSpecialist: calcRate(stats.archetypes.poissonSpecialist.wins, stats.archetypes.poissonSpecialist.total),
            historian: calcRate(stats.archetypes.historian.wins, stats.archetypes.historian.total),
            modernist: calcRate(stats.archetypes.modernist.wins, stats.archetypes.modernist.total),
            trendChaser: calcRate(stats.archetypes.trendChaser.wins, stats.archetypes.trendChaser.total),
            hereAndNow: calcRate(stats.archetypes.hereAndNow.wins, stats.archetypes.hereAndNow.total),
            longView: calcRate(stats.archetypes.longView.wins, stats.archetypes.longView.total)
        };
    } catch (error) {
        console.error('Error displaying personal insights:', error);
        return { error: error.message };
    }
}

async function generatePersonalLessons(stats, apiKey) {
    const calcRate = (wins, total) => total > 0 ? (wins / total) : -1;

    // Build archetype report with ALL 8 archetypes
    let archetypeReport = "\n**Your Archetype Performance:**\n";
    
    // Model specialists
    if (stats.archetypes.nnSpecialist.total > 0) {
        archetypeReport += `- 'Pattern Scout' (NN-heavy) Success: ${Math.round(calcRate(stats.archetypes.nnSpecialist.wins, stats.archetypes.nnSpecialist.total) * 100)}%\n`;
    }
    if (stats.archetypes.lrSpecialist.total > 0) {
        archetypeReport += `- 'Linear Thinker' (LR-heavy) Success: ${Math.round(calcRate(stats.archetypes.lrSpecialist.wins, stats.archetypes.lrSpecialist.total) * 100)}%\n`;
    }
    if (stats.archetypes.poissonSpecialist.total > 0) {
        archetypeReport += `- 'Goal Scorer' (Poisson-heavy) Success: ${Math.round(calcRate(stats.archetypes.poissonSpecialist.wins, stats.archetypes.poissonSpecialist.total) * 100)}%\n`;
    }
    
    // Data range styles
    if (stats.archetypes.historian.total > 0) {
        archetypeReport += `- 'The Historian' (6 seasons) Success: ${Math.round(calcRate(stats.archetypes.historian.wins, stats.archetypes.historian.total) * 100)}%\n`;
    }
    if (stats.archetypes.modernist.total > 0) {
        archetypeReport += `- 'The Modernist' (2-3 seasons) Success: ${Math.round(calcRate(stats.archetypes.modernist.wins, stats.archetypes.modernist.total) * 100)}%\n`;
    }
    if (stats.archetypes.trendChaser.total > 0) {
        archetypeReport += `- 'The Trend Chaser' (high recency) Success: ${Math.round(calcRate(stats.archetypes.trendChaser.wins, stats.archetypes.trendChaser.total) * 100)}%\n`;
    }
    
    // Combination styles
    if (stats.archetypes.hereAndNow.total > 0) {
        archetypeReport += `- 'Here and Now' (Recent focus) Success: ${Math.round(calcRate(stats.archetypes.hereAndNow.wins, stats.archetypes.hereAndNow.total) * 100)}%\n`;
    }
    if (stats.archetypes.longView.total > 0) {
        archetypeReport += `- 'Long View' (Historical focus) Success: ${Math.round(calcRate(stats.archetypes.longView.wins, stats.archetypes.longView.total) * 100)}%\n`;
    }

    const insightsString = `
- Total Predictions Analyzed: ${stats.totalCompleted}
- Kraken's High-Confidence Success Rate: ${Math.round(calcRate(stats.kraken.highConfidenceHits, stats.kraken.highConfidenceTotal) * 100)}%
- Captain's Win Rate (when disagreeing with Kraken): ${Math.round(calcRate(stats.captainVsKraken.captainWins, stats.captainVsKraken.disputes) * 100)}%
- All-Agreement Success Rate: ${Math.round(calcRate(stats.agreement.allAgreeWins, stats.agreement.allAgreeTotal) * 100)}%
- Kraken's Underdog Success Rate (vs. Elo): ${Math.round(calcRate(stats.elo.krakenUnderdogWins, stats.elo.krakenPicksUnderdog) * 100)}%
${archetypeReport}
`;

    const prompt = `**Persona:** You are Captain Turfbeard, reflecting on your crew's performance. Your tone is wise and analytical, but still in your pirate voice.

**Task:** I have analyzed our past predictions from the logbook. Your job is to turn these numbers into 3 insightful "lessons learned" for the crew.

**The Data from the Analyst:**
${insightsString}

**Instructions:**
1. Carefully consider all the data. You MUST generate at least one lesson based on the "Archetype Performance Report", comparing different styles if possible.
2. Look for the most interesting or actionable patterns. Is the Captain's gut feeling paying off? Is it wise to trust the Kraken when it picks an underdog? Are certain tactics working better than others?
3. Write 3 distinct lessons. They must sound like they come from a wise pirate captain.
4. Your entire response MUST be a single JSON object with ONE key: "lessons". The value must be an array of 3 strings.

**Example Response:**
{
  "lessons": [
    "Avast! The 'Here and Now' tactic is paying off handsomely, outperforming the 'Long View' by a wide margin.",
    "A Captain's gut is a worthy compass! When my final orders go against the Kraken's cold calculations, my intuition has been the winning map.",
    "When the whole crew sings the same shanty - myself, the Kraken, and the bookmakers - we haul in the treasure nearly every time!"
  ]
}`;

    try {
        const responseText = await callGemini(prompt, apiKey, false);
        let cleanedResponse = responseText.replace(/```json|```/g, '').trim();
        const jsonStart = cleanedResponse.indexOf('{');
        const jsonEnd = cleanedResponse.lastIndexOf('}');
        
        if (jsonStart === -1 || jsonEnd === -1) {
            throw new Error('No valid JSON in lesson response');
        }
        
        cleanedResponse = cleanedResponse.substring(jsonStart, jsonEnd + 1);
        const parsed = JSON.parse(cleanedResponse);
        
        if (parsed.lessons && Array.isArray(parsed.lessons)) {
            return parsed.lessons;
        }
        
        return ["The winds be unclear, but we sail on!"];
    } catch (error) {
        console.error('Error generating lessons:', error);
        return ["The Captain's logbook be too complex to decipher at this time."];
    }
}

// Helper for Gemini calls
async function callGemini(promptText, apiKey, useGrounding) {
    const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
    
    const requestBody = {
        contents: [{
            parts: [{ text: promptText }]
        }],
        generationConfig: {
            maxOutputTokens: 8192,
            temperature: 0.7
        }
    };

    if (useGrounding) {
        requestBody.tools = [{
            google_search_retrieval: {
                dynamic_retrieval_config: {
                    mode: "MODE_DYNAMIC",
                    dynamic_threshold: 0.3
                }
            }
        }];
    }

    const response = await fetch(`${endpoint}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        throw new Error(`API call failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}

// --- Export / Import ---
async function exportData() {
    try {
        const data = await exportAllData();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `captain-turfbeard-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        alert('Data exported successfully!');
    } catch (error) {
        console.error('Export error:', error);
        alert(`Export failed: ${error.message}`);
    }
}

async function importDataFromFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            await importData(data);
            await loadPredictions();
            alert('Data imported successfully!');
        } catch (error) {
            console.error('Import error:', error);
            alert(`Import failed: ${error.message}`);
        }
    };
    
    input.click();
}

// --- Helper function to update personal insights display ---
async function updatePersonalInsightsDisplay() {
    const contentEl = safeGetElement('personal-insights-content');
    if (!contentEl) return;

    contentEl.innerHTML = '<p class="text-center italic text-gray-600">Analyzing your personal logbook...</p>';

    try {
        const insights = await displayPersonalInsights();

        if (insights.error) {
            contentEl.innerHTML = `<p class="text-center italic text-gray-600">${insights.error}</p>`;
            return;
        }

        const archetypeNames = {
            nnSpecialist: "The Specialist (Pattern Scout)",
            lrSpecialist: "The Specialist (Linear Thinker)",
            poissonSpecialist: "The Specialist (Goal Scorer)",
            historian: "The Historian",
            modernist: "The Modernist",
            trendChaser: "The Trend Chaser",
            hereAndNow: "The 'Here and Now' Tactician",
            longView: "The 'Long View' Historian",
        };

        // Convert insights to sorted array
        const sortedInsights = Object.entries(insights)
            .filter(([_, rate]) => rate !== -1)
            .sort(([, rateA], [, rateB]) => rateB - rateA);

        if (sortedInsights.length === 0) {
            contentEl.innerHTML = `<p class="text-center italic text-gray-600">You haven't used any specific archetypes enough times for a report. Keep making predictions!</p>`;
            return;
        }

        const bestStyle = sortedInsights[0];
        let html = `<p class="text-center"><span class="font-bold">Your most successful tactic so far is</span><br><span class="font-pirata text-2xl text-blue-800">${archetypeNames[bestStyle[0]]}</span><br><span class="font-bold">with a ${Math.round(bestStyle[1] * 100)}% success rate.</span></p>`;
        
        if (sortedInsights.length > 1) {
            html += `<hr class="my-3 border-dashed border-blue-200">`;
            html += `<p class="text-center font-bold mb-2">Other Tactic Performance:</p><ul class="space-y-1 text-center text-sm">`;
            sortedInsights.slice(1).forEach(([name, rate]) => {
                html += `<li><strong>${archetypeNames[name]}:</strong> ${Math.round(rate * 100)}% success rate</li>`;
            });
            html += `</ul>`;
        }
        
        contentEl.innerHTML = html;
    } catch (error) {
        console.error('Error updating personal insights:', error);
        contentEl.innerHTML = `<p class="text-center text-red-500">Error loading insights: ${error.message}</p>`;
    }
}

// --- Load Predictions ---
async function loadPredictions() {
    const predictions = await getAllPredictions();
    setUnlockedPredictions(predictions);
    renderFixtureUI();
    renderLedger(predictions);
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await initDB();
        initWorker();
        initializeToggleListeners();
        setStatus('Choose yer ocean and plunder the depths.', false);

        // Load existing predictions
        await loadPredictions();

        // Check if API key is set
        const apiKey = await getApiKey();
        if (!apiKey) {
            setTimeout(() => {
                alert('Welcome! Please set your Gemini API key in Settings to begin.');
                showApiKeyModal();
            }, 1000);
        }

        // Setup modals
        const setupModal = (modalId, openBtnId, closeBtnId) => {
            const modal = safeGetElement(modalId);
            const openBtn = safeGetElement(openBtnId);
            const closeBtn = safeGetElement(closeBtnId);
            if (modal && closeBtn && (openBtn || openBtnId === null)) {
                if (openBtn) addManagedEventListener(openBtn, 'click', () => modal.classList.remove('hidden'));
                addManagedEventListener(closeBtn, 'click', () => modal.classList.add('hidden'));
                addManagedEventListener(modal, 'click', (e) => {
                    if (e.target === modal) modal.classList.add('hidden');
                });
            }
        };

        // API Key Modal
        setupModal('api-key-modal', 'open-api-key-btn', 'close-api-key-btn');
        const saveApiKeyBtn = safeGetElement('save-api-key-btn');
        if (saveApiKeyBtn) {
            addManagedEventListener(saveApiKeyBtn, 'click', validateAndSaveApiKey);
        }

        setupModal('log-book-section', 'log-book-btn', 'close-log-book-btn');
        setupModal('analysis-modal', null, 'close-analysis-modal-btn');
        setupModal('helm-modal', 'open-helm-btn', 'close-helm-btn');

        // Helm settings
        const helmModal = safeGetElement('helm-modal');
        const openHelmBtn = safeGetElement('open-helm-btn');
        if (helmModal && openHelmBtn) {
            addManagedEventListener(openHelmBtn, 'click', async () => {
                const settings = await getAllSettings();
                const helmSettings = settings.krakenHelmSettings || {};
                
                safeGetElement('nn-weight-slider').value = helmSettings.nnWeight ?? 40;
                safeGetElement('lr-weight-slider').value = helmSettings.lrWeight ?? 25;
                safeGetElement('poisson-weight-slider').value = helmSettings.poissonWeight ?? 35;
                safeGetElement('temp-slider').value = (helmSettings.temperature ?? 1.5) * 10;
                safeGetElement('data-range-slider').value = helmSettings.trainingDataRange ?? 6;
                safeGetElement('recency-slider').value = helmSettings.recencyWeighting ?? 50;
                const features = helmSettings.features || {};
                safeGetElement('feature-form-checkbox').checked = features.form ?? true;
                safeGetElement('feature-h2h-checkbox').checked = features.h2h ?? true;
                safeGetElement('feature-elo-checkbox').checked = features.elo ?? true;
                safeGetElement('feature-offense-checkbox').checked = features.offense ?? true;
                safeGetElement('feature-defense-checkbox').checked = features.defense ?? true;
                safeGetElement('feature-congestion-checkbox').checked = features.congestion ?? true;

                helmModal.querySelectorAll('input[type="range"]').forEach(slider => {
                    slider.dispatchEvent(new Event('input'));
                });
                
                helmModal.classList.remove('hidden');
            });

            // Weight sliders
            const updateWeightSliders = (changedSlider) => {
                const sliders = ['nn-weight-slider', 'lr-weight-slider', 'poisson-weight-slider'].map(safeGetElement);
                const changedValue = parseInt(changedSlider.value);
                const remaining = 100 - changedValue;
                const otherSliders = sliders.filter(s => s !== changedSlider);
                const otherValuesSum = otherSliders.reduce((sum, s) => sum + parseInt(s.value), 0);
                
                if (otherValuesSum === 0) {
                    otherSliders.forEach(s => s.value = Math.floor(remaining / otherSliders.length));
                } else {
                    otherSliders.forEach(s => s.value = Math.round(remaining * (parseInt(s.value) / otherValuesSum)));
                }
                
                let finalTotal = sliders.reduce((sum, s) => sum + parseInt(s.value), 0);
                if (finalTotal !== 100) changedSlider.value = parseInt(changedSlider.value) + (100 - finalTotal);

                sliders.forEach(s => s.dispatchEvent(new Event('input')));
            };

            addManagedEventListener(safeGetElement('nn-weight-slider'), 'input', e => safeGetElement('nn-weight-value').textContent = e.target.value);
            addManagedEventListener(safeGetElement('lr-weight-slider'), 'input', e => safeGetElement('lr-weight-value').textContent = e.target.value);
            addManagedEventListener(safeGetElement('poisson-weight-slider'), 'input', e => safeGetElement('poisson-weight-value').textContent = e.target.value);
            
            addManagedEventListener(safeGetElement('nn-weight-slider'), 'change', e => updateWeightSliders(e.target));
            addManagedEventListener(safeGetElement('lr-weight-slider'), 'change', e => updateWeightSliders(e.target));
            addManagedEventListener(safeGetElement('poisson-weight-slider'), 'change', e => updateWeightSliders(e.target));

            addManagedEventListener(safeGetElement('temp-slider'), 'input', e => {
                const val = parseInt(e.target.value);
                const label = safeGetElement('temp-value-label');
                if (val < 13) label.textContent = 'Cautious';
                else if (val > 17) label.textContent = 'Confident';
                else label.textContent = 'Balanced';
            });
            addManagedEventListener(safeGetElement('data-range-slider'), 'input', e => {
                const val = e.target.value;
                safeGetElement('data-range-value').textContent = `${val} ${val > 1 ? 'Seasons' : 'Season'}`;
            });
            addManagedEventListener(safeGetElement('recency-slider'), 'input', e => {
                const val = parseInt(e.target.value);
                const label = safeGetElement('recency-value-label');
                if (val < 10) label.textContent = 'None';
                else if (val < 40) label.textContent = 'Low';
                else if (val < 70) label.textContent = 'Medium';
                else label.textContent = 'High';
            });
            
            addManagedEventListener(safeGetElement('save-settings-btn'), 'click', async () => {
                const saveBtn = safeGetElement('save-settings-btn');
                const helmStatus = safeGetElement('helm-status');
                helmStatus.textContent = 'Saving...';
                saveBtn.disabled = true;

                const settingsToSave = {
                    nnWeight: parseInt(safeGetElement('nn-weight-slider').value),
                    lrWeight: parseInt(safeGetElement('lr-weight-slider').value),
                    poissonWeight: parseInt(safeGetElement('poisson-weight-slider').value),
                    temperature: parseFloat(safeGetElement('temp-slider').value / 10),
                    trainingDataRange: parseInt(safeGetElement('data-range-slider').value),
                    recencyWeighting: parseInt(safeGetElement('recency-slider').value),
                    features: {
                        form: safeGetElement('feature-form-checkbox').checked,
                        h2h: safeGetElement('feature-h2h-checkbox').checked,
                        elo: safeGetElement('feature-elo-checkbox').checked,
                        offense: safeGetElement('feature-offense-checkbox').checked,
                        defense: safeGetElement('feature-defense-checkbox').checked,
                        congestion: safeGetElement('feature-congestion-checkbox').checked,
                    }
                };

                try {
                    await saveSetting('krakenHelmSettings', settingsToSave);
                    helmStatus.textContent = 'Orders saved!';
                } catch (error) {
                    helmStatus.textContent = error.message;
                } finally {
                    setTimeout(() => {
                        saveBtn.disabled = false;
                        helmStatus.textContent = '';
                    }, 2000);
                }
            });
        }

        // Tab switching
        const logBookTabs = document.querySelectorAll('.tab-btn');
        logBookTabs.forEach(tab => {
            addManagedEventListener(tab, 'click', async () => {
                const targetTab = tab.dataset.tab;
                
                // When switching to charts tab, update personal insights
                if (targetTab === 'charts') {
                    await updatePersonalInsightsDisplay();
                }
                
                logBookTabs.forEach(t => {
                    const isActive = t.dataset.tab === targetTab;
                    t.classList.toggle('bg-amber-800', isActive);
                    t.classList.toggle('text-white', isActive);
                    t.classList.toggle('bg-amber-200', !isActive);
                    t.classList.toggle('text-amber-800', !isActive);
                });
                document.querySelectorAll('.tab-panel').forEach(panel => {
                    panel.classList.toggle('hidden', panel.id !== `tab-panel-${targetTab}`);
                });
            });
        });

        // Main action buttons
        addManagedEventListener(safeGetElement('fetch-data-btn'), 'click', fetchAndStoreData);
        addManagedEventListener(safeGetElement('find-fixtures-btn'), 'click', async () => {
            const leagueSelect = safeGetElement('league-select');
            const selectedOption = leagueSelect.options[leagueSelect.selectedIndex];
            if (selectedOption) {
                const isTestMode = safeGetElement('test-mode-checkbox')?.checked || false;
                await findFixturesWithGemini(selectedOption.text, selectedOption.value, isTestMode);
            }
        });

        addManagedEventListener(safeGetElement('train-models-btn'), 'click', async () => {
            const historicalMatches = await getAllMatchesFromDB();
            if (historicalMatches.length === 0) {
                setStatus('No data available to train - plunder some data first!', false);
                return;
            }
            const settings = await getAllSettings();
            const helmSettings = settings.krakenHelmSettings;
            const trainingParams = {
                dataRange: helmSettings?.trainingDataRange ?? 6,
                recencyWeighting: (helmSettings?.recencyWeighting ?? 50) / 100.0,
                features: helmSettings?.features ?? { form: true, h2h: true, elo: true, offense: true, defense: true, congestion: true }
            };
            
            trainedLeagueCode = safeGetElement('league-select').value;
            trainModels(historicalMatches, trainingParams);
        });

        addManagedEventListener(safeGetElement('retrain-kraken-btn'), 'click', async () => {
            const historicalMatches = await getAllMatchesFromDB();
            if (historicalMatches.length === 0) {
                setStatus('No data available to train - plunder some data first!', false);
                return;
            }
            const settings = await getAllSettings();
            const helmSettings = settings.krakenHelmSettings;
            const trainingParams = {
                dataRange: helmSettings?.trainingDataRange ?? 6,
                recencyWeighting: (helmSettings?.recencyWeighting ?? 50) / 100.0,
                features: helmSettings?.features ?? { form: true, h2h: true, elo: true, offense: true, defense: true, congestion: true }
            };
            
            trainedLeagueCode = safeGetElement('league-select').value;
            trainModels(historicalMatches, trainingParams);
        });

        // New buttons for local operation
        addManagedEventListener(safeGetElement('fetch-results-btn'), 'click', fetchMatchResults);
        addManagedEventListener(safeGetElement('analyze-performance-btn'), 'click', analyzePersonalPerformance);
        addManagedEventListener(safeGetElement('export-data-btn'), 'click', exportData);
        addManagedEventListener(safeGetElement('import-data-btn'), 'click', importDataFromFile);

    } catch (error) {
        console.error('Error during initialization:', error);
        setStatus('Failed to initialize the ship properly!', false);
    }
});

// Delegated event listener for dynamic buttons
document.addEventListener('click', async (event) => {
    try {
        const unlockButton = event.target.closest('.unlock-btn');
        const predictButton = event.target.closest('.predict-btn, .reforecast-btn');
        const quartermasterButton = event.target.closest('.quartermaster-btn');
        const captainButton = event.target.closest('.captain-btn');
        const saveGuessButton = event.target.closest('.save-guess-btn');
        const viewButton = event.target.closest('.view-analysis-btn');

        if (unlockButton) {
            const { fixtureId } = unlockButton.dataset;
            if (fixtureId) {
                const fixtureToUnlock = allFoundFixtures.find(f => f.id == fixtureId);
                if (fixtureToUnlock) await unlockFixture(fixtureToUnlock);
            }
        } else if (predictButton) {
            const { index, predictionId } = predictButton.dataset;
            const currentPrediction = unlockedPredictions.find(p => p.id == predictionId);
            if (!currentPrediction) {
                console.error("Could not find prediction to run forecast.");
                return;
            }
            const settings = await getAllSettings();
            const customSettings = settings.krakenHelmSettings || null;
            await runPrediction(currentPrediction.fixture, index, predictionId, customSettings);
        } else if (quartermasterButton) {
            const { hometeam, awayteam, index, predictionId } = quartermasterButton.dataset;
            await getQuartermasterReportLocal(hometeam, awayteam, index, predictionId);
        } else if (captainButton) {
            const { hometeam, awayteam, index, predictionId } = captainButton.dataset;
            const currentPrediction = unlockedPredictions.find(p => p.id == predictionId);
            if (currentPrediction) await getCaptainReviewLocal(hometeam, awayteam, index, predictionId, currentPrediction);
        } else if (saveGuessButton) {
            const { predictionId, index, prefix = '' } = saveGuessButton.dataset;
            const homeScore = safeGetElement(`${prefix}home-guess-${index}`)?.value;
            const awayScore = safeGetElement(`${prefix}away-guess-${index}`)?.value;
            if (!homeScore || !awayScore || homeScore < 0 || awayScore < 0) {
                alert('Please enter valid scores for both teams!');
            } else {
                await saveUserGuess(predictionId, homeScore, awayScore);
            }
        } else if (viewButton) {
            const { predictionId } = viewButton.dataset;
            if (predictionId) showAnalysisModal(predictionId);
        }
    } catch (error) {
        console.error('Error in delegated event handler:', error);
        alert('Something went wrong. Please try again!');
    }
});

function cleanup() {
    console.log('Running cleanup...');
    eventListeners.forEach((handler, key) => {
        const [elementId, eventType] = key.split('_');
        const element = document.getElementById(elementId);
        if (element) {
            element.removeEventListener(eventType, handler);
        }
    });
    eventListeners.clear();
    cleanupWorker();
}

window.addEventListener('pagehide', cleanup);
window.addEventListener('beforeunload', cleanup);
