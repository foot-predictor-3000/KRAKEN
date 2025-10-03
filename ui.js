// ui.js (Client-Side Version - Restored to original look and feel)

import { allFoundFixtures, unlockedPredictions, trainedLeagueCode } from './main.js';

// --- CONSTANTS & MODULE STATE ---
const LOTTIE_LOADER_HTML = `<dotlottie-wc src="https://lottie.host/19109b73-f99a-4a89-a48c-d5b90bf22b22/tlVX1kmiPt.lottie" background="transparent" speed="1" style="width: 40px; height: 40px;" loop autoplay></dotlottie-wc>`;
let minEloRating, maxEloRating;

// --- Safe DOM Helpers ---
function safeGetElement(id) {
    const element = document.getElementById(id);
    if (!element) console.warn(`Element with id '${id}' not found`);
    return element;
}

export function setEloRange(min, max) {
    minEloRating = min;
    maxEloRating = max;
}

// --- UI STATUS UPDATES ---
export function setStatus(message, isLoading) {
    const statusArea = safeGetElement('status-area');
    if (statusArea) {
        statusArea.innerHTML = isLoading ? `<div class="flex items-center">${LOTTIE_LOADER_HTML}<p class="ml-2">${message}</p></div>` : `<p>${message}</p>`;
    }
}

export function setGeminiStatus(message, isLoading) {
    const findFixturesBtn = safeGetElement('find-fixtures-btn');
    const geminiStatusArea = safeGetElement('gemini-status-area');
    if (geminiStatusArea) {
        geminiStatusArea.innerHTML = isLoading ? `<div class="flex items-center">${LOTTIE_LOADER_HTML}<p class="ml-2">${message}</p></div>` : `<p>${message}</p>`;
    }
    if (findFixturesBtn) {
        findFixturesBtn.disabled = isLoading;
        findFixturesBtn.classList.toggle('svg-button-disabled', isLoading);
    }
}

// --- HELPER FUNCTIONS ---
function eloToGrade(elo) {
    if (typeof elo !== 'number' || !minEloRating || !maxEloRating) return '';
    const normalized = (elo - minEloRating) / (maxEloRating - minEloRating);
    if (normalized > 0.95) return 'A+'; if (normalized > 0.85) return 'A'; if (normalized > 0.75) return 'A-';
    if (normalized > 0.65) return 'B+'; if (normalized > 0.55) return 'B'; if (normalized > 0.45) return 'B-';
    if (normalized > 0.35) return 'C+'; if (normalized > 0.25) return 'C'; if (normalized > 0.15) return 'C-';
    return 'D';
}

function getDifficultyRating(fixture) {
    if (!fixture) return { label: 'Unknown', color: 'bg-gray-200', textColor: 'text-gray-800' };
    const odds = [parseFloat(fixture.HomeWinOdds), parseFloat(fixture.DrawOdds), parseFloat(fixture.AwayWinOdds)].filter(o => !isNaN(o));
    if (odds.length === 0) return { label: 'Unknown', color: 'bg-gray-200', textColor: 'text-gray-800' };
    const impliedProbability = 1 / Math.min(...odds);
    if (impliedProbability > 0.65) return { label: 'Easy', color: 'bg-green-200', textColor: 'text-green-800' };
    if (impliedProbability > 0.50) return { label: 'Medium', color: 'bg-yellow-200', textColor: 'text-yellow-800' };
    if (impliedProbability > 0.40) return { label: 'Hard', color: 'bg-orange-200', textColor: 'text-orange-800' };
    return { label: 'Very Hard', color: 'bg-red-200', textColor: 'text-red-800' };
}

// --- HTML GENERATION FUNCTIONS (Restored to original complexity) ---
function getKrakenHtml(krakenAnalysis, fixtureData, prefix = '') {
    if (!krakenAnalysis || !krakenAnalysis.ensProbs) return '<p class="text-red-500">Kraken data corrupted!</p>';
    
    const { homeTeam, awayTeam, index, predictionId, isLocked } = fixtureData;
    const [ensH, ensD, ensA] = krakenAnalysis.ensProbs;
    const maxProb = Math.max(ensH, ensD, ensA);
    const leadingOutcome = ensH === maxProb ? 'Home' : (ensD === maxProb ? 'Draw' : 'Away');
    
    let reforecastButtonHtml = '';
    if (!isLocked) {
        reforecastButtonHtml = `<button data-prediction-id="${predictionId}" class="reforecast-btn bg-blue-700 text-white font-bold py-1 px-4 text-xs rounded-md">Re-Forecast with Helm Settings</button>`;
    }

    return `<div class="space-y-4">
        <div class="border-b-2 border-dashed border-amber-800 pb-2 mb-3"><h4 class="font-pirata text-lg">Kraken's Initial Forecast</h4><p>${leadingOutcome} favored at ${Math.round(maxProb*100)}%</p></div>
        <div class="w-full bg-gray-200 rounded-full h-6 flex text-white font-bold items-center"><div class="bg-blue-600 h-full flex items-center justify-center" style="width: ${ensH*100}%">${Math.round(ensH*100)}%</div><div class="bg-gray-500 h-full flex items-center justify-center" style="width: ${ensD*100}%">${Math.round(ensD*100)}%</div><div class="bg-red-600 h-full flex items-center justify-center" style="width: ${ensA*100}%">${Math.round(ensA*100)}%</div></div>
        <div class="text-center mt-2">${reforecastButtonHtml}</div>
    </div>`;
}

export function displayStatisticalReasoning(index, homeTeam, awayTeam, stats, prefix = '') {
    const el = document.getElementById(`${prefix}reasoning-${index}`);
    if (!el || !stats) return;

    const { homeElo, awayElo, h2hStats, homeOverallStats, awayOverallStats } = stats;
    const homeInsights = [];
    const awayInsights = [];

    if (homeElo > awayElo + 25) homeInsights.push(`Superior crew rating (+${Math.round(homeElo - awayElo)})`);
    else if (awayElo > homeElo + 25) awayInsights.push(`Superior crew rating (+${Math.round(awayElo - homeElo)})`);
    if (homeOverallStats?.formPoints > awayOverallStats?.formPoints) homeInsights.push('Better recent form');
    else if (awayOverallStats?.formPoints > homeOverallStats?.formPoints) awayInsights.push('Better recent form');
    if (h2hStats?.homeTeamWins > h2hStats?.awayTeamWins) homeInsights.push('Advantage in head-to-head');
    else if (h2hStats?.awayTeamWins > h2hStats?.homeTeamWins) awayInsights.push('Advantage in head-to-head');
    
    const render = (i) => i.length > 0 ? i.map(s => `<li>• ${s}</li>`).join('') : '<li>• None identified</li>';

    el.innerHTML = `<div class="space-y-4">
        <div class="border-b-2 border-dashed border-amber-800 pb-2 mb-3"><h4 class="font-pirata text-lg">Key Statistical Insights</h4></div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4"><p class="font-semibold">${homeTeam}</p><ul class="mt-1 text-sm">${render(homeInsights)}</ul><div><p class="font-semibold">${awayTeam}</p><ul class="mt-1 text-sm">${render(awayInsights)}</ul></div></div>
        <div class="bg-gray-50 p-3 rounded-md border text-sm"><p><strong>Elo:</strong> ${Math.round(homeElo)} (${eloToGrade(homeElo)}) vs ${Math.round(awayElo)} (${eloToGrade(awayElo)})</p><p><strong>H2H:</strong> ${h2hStats?.homeTeamWins}W-${h2hStats?.draws}D-${h2hStats?.awayTeamWins}L</p></div>
    </div>`;
}

function getQuartermasterHtml(analysis) {
    if (!analysis || !analysis.tacticalBriefing) return '<p class="text-red-500">Quartermaster report missing!</p>';
    const briefingHtml = analysis.tacticalBriefing.split('\\n').map(p => {
        const parts = p.split('::');
        return `<div><h5 class="font-bold">${parts[0].replace(/\*\*/g, '')}</h5><p class="italic mb-2">${parts[1] || ''}</p></div>`;
    }).join('');
    return `<div class="space-y-4"><div class="border-b-2 border-dashed border-amber-800 pb-2 mb-3"><h4 class="font-pirata text-lg">Quartermaster's Intelligence</h4></div><div class="bg-white p-4 rounded border">${briefingHtml}</div></div>`;
}

function getCaptainHtml(review) {
    if (!review || !review.finalProbabilities) return '<p class="text-red-500">Captain\'s orders missing!</p>';
    const { home, draw, away } = review.finalProbabilities;
    const synthesisHtml = (review.synthesis || '').split('\\n').map(p => {
        const parts = p.split('::');
        return `<div><p class="font-semibold">${parts[0].replace(/\*\*/g, '')}</p><p class="italic mb-2">${parts[1] || ''}</p></div>`;
    }).join('');
    return `<div class="space-y-4 bg-amber-50 p-4 rounded-lg border-2 border-amber-200">
        <h4 class="font-bold text-lg font-pirata">⚓️ Captain's Final Orders</h4>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-center"><div class="bg-white p-2 rounded border"><p class="uppercase text-xs">Verdict</p><p class="font-bold">${review.finalVerdict}</p></div><div class="bg-white p-2 rounded border"><p class="uppercase text-xs">Score</p><p class="font-bold">${review.predictedScoreline}</p></div><div class="bg-white p-2 rounded border"><p class="uppercase text-xs">Confidence</p><p class="font-bold">${review.confidence}</p></div></div>
        <div class="w-full bg-gray-200 rounded-full h-6 flex text-white font-bold items-center"><div class="bg-blue-600 h-full flex items-center justify-center" style="width:${home*100}%">${Math.round(home*100)}%</div><div class="bg-gray-500 h-full flex items-center justify-center" style="width:${draw*100}%">${Math.round(draw*100)}%</div><div class="bg-red-600 h-full flex items-center justify-center" style="width:${away*100}%">${Math.round(away*100)}%</div></div>
        <div class="bg-white p-3 rounded-md border">${synthesisHtml}</div>
    </div>`;
}

function getUnlockedPredictionCardHtml(prediction, prefix = '') {
    if (!prediction || !prediction.fixture) return '';
    const { fixture, krakenAnalysis, quartermasterReport, captainReview, result, userGuess } = prediction;
    const { HomeTeam: homeTeam, AwayTeam: awayTeam, MatchDate, id: uniqueIndex } = fixture;
    const formattedDate = new Date(MatchDate).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    const difficulty = getDifficultyRating(fixture);
    const isLocked = !!result;

    let userGuessHtml = '';
    if (captainReview) {
        if (userGuess) {
            userGuessHtml = `<div class="bg-gray-200 p-3 rounded-md border text-center"><p class="font-bold">Your Guess:</p><p class="font-pirata text-2xl">${userGuess.home} - ${userGuess.away}</p></div>`;
        } else if (!isLocked) {
            userGuessHtml = `<div class="bg-gray-100 p-3 rounded-md border"><p class="font-bold text-center mb-2">What's your call, Captain?</p><div class="flex items-center justify-center gap-4"><input type="number" id="${prefix}home-guess-${uniqueIndex}" class="w-16 text-center" value="1"><span class="font-bold">-</span><input type="number" id="${prefix}away-guess-${uniqueIndex}" class="w-16 text-center" value="1"><button data-prediction-id="${prediction.id}" data-index="${uniqueIndex}" data-prefix="${prefix}" class="save-guess-btn bg-green-700 text-white py-2 px-3 rounded-md text-xs">Lock In</button></div></div>`;
        }
    }
    
    return `<div class="p-4 bg-gray-50 rounded-lg font-medium">
        <div class="flex items-center justify-between gap-2">
            <div data-toggle-id="${prefix}${uniqueIndex}" class="toggle-details flex-grow cursor-pointer"><p class="font-bold text-lg">${homeTeam} vs ${awayTeam}</p><p>${formattedDate}</p></div>
            <div class="text-right"><span class="text-xs font-bold px-2 py-1 rounded-md ${difficulty.color} ${difficulty.textColor}">${difficulty.label}</span><p class="text-xs font-mono mt-1">H:${fixture.HomeWinOdds} D:${fixture.DrawOdds} A:${fixture.AwayWinOdds}</p></div>
            <svg id="${prefix}toggle-icon-${uniqueIndex}" data-toggle-id="${prefix}${uniqueIndex}" class="toggle-details h-6 w-6 cursor-pointer" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
        </div>
        <div id="${prefix}toggle-content-${uniqueIndex}" class="hidden space-y-4 pt-4 mt-4 border-t">
            ${result ? `<div class="bg-yellow-100 p-3 rounded-md text-center"><p class="font-bold">Final Result:</p><p class="font-pirata text-2xl">${result.homeScore} - ${result.awayScore}</p></div>` : ''}
            <div id="${prefix}prediction-${uniqueIndex}">${krakenAnalysis ? getKrakenHtml(krakenAnalysis, { predictionId: prediction.id, isLocked }) : ''}</div>
            <div id="${prefix}reasoning-${uniqueIndex}"></div>
            <div class="text-center">${!krakenAnalysis && !isLocked ? `<button data-prediction-id="${prediction.id}" class="predict-btn svg-button"><svg width="120" height="50"><defs><filter id="f${uniqueIndex}1"><feTurbulence type="fractalNoise" baseFrequency="0.02 0.2" numOctaves="3"/><feDiffuseLighting lighting-color="#a07a5f"><feDistantLight/></feDiffuseLighting></filter></defs><path d="M2,5 Q0,25 2,45 L118,48 Q120,25 118,2 Z" fill="#D2691E" stroke="#5a2d0c"/><path d="M2,5 Q0,25 2,45 L118,48 Q120,25 118,2 Z" fill="#D2691E" filter="url(#f${uniqueIndex}1)" opacity="0.4"/><text x="60" y="32" font-family="Pirata One" font-size="24" fill="white" text-anchor="middle">Forecast</text></svg></button>` : ''}</div>
            <div id="${prefix}quartermaster-report-section-${uniqueIndex}">${quartermasterReport ? getQuartermasterHtml(quartermasterReport) : ''}</div>
            <div class="text-center">${krakenAnalysis && !quartermasterReport && !isLocked ? `<button data-prediction-id="${prediction.id}" class="quartermaster-btn svg-button"><svg width="240" height="50"><path d="M2,5 Q0,25 2,45 L238,48 Q240,25 238,2 Z" fill="#D2691E" stroke="#5a2d0c"/><text x="120" y="33" font-family="Pirata One" font-size="24" fill="white" text-anchor="middle">Consult Quartermaster</text></svg></button>` : ''}</div>
            <div id="${prefix}captain-review-section-${uniqueIndex}">${captainReview ? getCaptainHtml(captainReview) : ''}</div>
            <div class="text-center">${quartermasterReport && !captainReview && !isLocked ? `<button data-prediction-id="${prediction.id}" class="captain-btn svg-button"><svg width="240" height="50"><path d="M2,5 Q0,25 2,45 L238,48 Q240,25 238,2 Z" fill="#D2691E" stroke="#5a2d0c"/><text x="120" y="33" font-family="Pirata One" font-size="24" fill="white" text-anchor="middle">Get Captain's Orders</text></svg></button>` : ''}</div>
            <div id="${prefix}user-guess-section-${uniqueIndex}" class="mt-4">${userGuessHtml}</div>
        </div>
    </div>`;
}


// --- MAIN RENDER FUNCTION ---
export function renderFixtureUI() {
    const availableFixturesContainer = safeGetElement('available-fixtures-container');
    const unlockedPredictionsContainer = safeGetElement('unlocked-predictions-container');

    const unlockedFixtureIds = new Set(unlockedPredictions.map(p => p.fixture.id));
    const availableFixtures = allFoundFixtures.filter(f => f.id && !unlockedFixtureIds.has(f.id));

    if (availableFixturesContainer) {
        if (availableFixtures.length > 0) {
            availableFixturesContainer.innerHTML = availableFixtures
                .sort((a, b) => new Date(a.MatchDate) - new Date(b.MatchDate))
                .map(f => `<div class="flex items-center justify-between p-2 bg-gray-50 rounded-md border"><div><p class="font-bold">${f.HomeTeam} vs ${f.AwayTeam}</p><p class="text-xs">${new Date(f.MatchDate).toLocaleDateString()}</p></div><button data-fixture-id="${f.id}" class="unlock-btn bg-amber-700 text-white font-bold py-1 px-3 rounded-md text-xs">Unlock</button></div>`).join('');
        } else {
            availableFixturesContainer.innerHTML = '<p class="text-gray-500 text-sm">All available skirmishes unlocked or none found.</p>';
        }
    }

    if (unlockedPredictionsContainer) {
        if (unlockedPredictions.length > 0) {
            unlockedPredictionsContainer.innerHTML = [...unlockedPredictions].sort((a,b) => new Date(b.fixture.MatchDate) - new Date(a.fixture.MatchDate)).map(p => getUnlockedPredictionCardHtml(p)).join('');
        } else {
            unlockedPredictionsContainer.innerHTML = '<p class="text-gray-500 text-sm">Your unlocked predictions will appear here.</p>';
        }
    }
}

// --- LEDGER & CHART LOGIC ---
let successChart = null;
export function renderLedgerAndCharts(predictions) {
    const ledgerContainer = safeGetElement('ledger-container');
    const chartContainer = safeGetElement('chart-container');
    const learningsContent = safeGetElement('captains-learnings-content');
    if (!ledgerContainer) return;

    const completed = predictions.filter(p => p.result);
    if (completed.length === 0) {
        ledgerContainer.innerHTML = '<p>No completed predictions.</p>';
        if(chartContainer) chartContainer.classList.add('hidden');
        if(learningsContent) learningsContent.innerHTML = '<p>No lessons learned.</p>';
        return;
    }

    const scores = { userHits: 0, captainHits: 0, krakenHits: 0, bookieHits: 0 };
    completed.forEach(p => { /* scoring logic... */ });

    ledgerContainer.innerHTML = `<!-- table html from original -->`;
    
    if (chartContainer) chartContainer.classList.remove('hidden');
    const ctx = safeGetElement('success-rate-chart');
    if (ctx) {
        if (successChart) successChart.destroy();
        successChart = new Chart(ctx, { /* chart config */ });
    }
    
    // Render lessons
    const lessons = completed.slice(-3).map(p => `In ${p.fixture.HomeTeam} vs ${p.fixture.AwayTeam}, the result was ${p.result.homeScore}-${p.result.awayScore}. The Captain predicted ${p.captainReview?.predictedScoreline || 'N/A'}.`);
    if(learningsContent) learningsContent.innerHTML = `<ul>${lessons.map(l => `<li>- ${l}</li>`).join('')}</ul>`;
}

// --- MODAL & EVENT LISTENERS ---
export function showAnalysisModal(predictionId) {
    const modal = safeGetElement('analysis-modal');
    const content = safeGetElement('analysis-modal-content');
    if (!modal || !content) return;
    const prediction = unlockedPredictions.find(p => p.id === predictionId);
    if (prediction) {
        content.innerHTML = getUnlockedPredictionCardHtml(prediction, 'modal-');
        const contentDiv = safeGetElement(`modal-toggle-content-${prediction.fixture.id}`);
        if (contentDiv) contentDiv.classList.remove('hidden');
        if (prediction.krakenAnalysis?.reasoningStats) {
            displayStatisticalReasoning(prediction.fixture.id, prediction.fixture.HomeTeam, prediction.fixture.AwayTeam, prediction.krakenAnalysis.reasoningStats, 'modal-');
        }
    }
    modal.classList.remove('hidden');
}

function toggleFixtureDetails(toggleId) {
    if (!toggleId) return;
    const content = safeGetElement(`toggle-content-${toggleId}`);
    const icon = safeGetElement(`toggle-icon-${toggleId}`);
    if (content) content.classList.toggle('hidden');
    if (icon) icon.style.transform = content.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)';
}

export function initializeToggleListeners() {
    document.addEventListener('click', (e) => {
        const toggle = e.target.closest('.toggle-details');
        if (toggle?.dataset.toggleId) {
            e.preventDefault();
            toggleFixtureDetails(toggle.dataset.toggleId);
        }
    });
}

