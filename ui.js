// ui.js (Client-Side Version)

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

function safeToggleClass(id, className, condition) {
    const element = safeGetElement(id);
    if (element) element.classList.toggle(className, condition);
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
        statusArea.innerHTML = isLoading ?
            `<div class="flex items-center">${LOTTIE_LOADER_HTML}<p class="ml-2">${message}</p></div>` :
            `<p>${message}</p>`;
    }
}

export function setGeminiStatus(message, isLoading) {
    const findFixturesBtn = safeGetElement('find-fixtures-btn');
    const geminiStatusArea = safeGetElement('gemini-status-area');
    if (geminiStatusArea) {
        geminiStatusArea.innerHTML = isLoading ?
            `<div class="flex items-center">${LOTTIE_LOADER_HTML}<p class="ml-2">${message}</p></div>` :
            `<p>${message}</p>`;
    }
    if (findFixturesBtn) {
        findFixturesBtn.disabled = isLoading;
        findFixturesBtn.classList.toggle('svg-button-disabled', isLoading);
    }
}

// --- HELPER FUNCTIONS ---
function eloToGrade(elo, minElo, maxElo) {
    if (typeof elo !== 'number' || typeof minElo !== 'number' || typeof maxElo !== 'number' || minElo === maxElo) return '';
    const normalized = (elo - minElo) / (maxElo - minElo);
    if (normalized > 0.85) return 'A';
    if (normalized > 0.65) return 'B';
    if (normalized > 0.45) return 'C';
    return 'D';
}

function getDifficultyRating(fixture) {
    if (!fixture) return { label: 'Unknown', color: 'bg-gray-200', textColor: 'text-gray-800' };
    const odds = [
        parseFloat(fixture.HomeWinOdds),
        parseFloat(fixture.DrawOdds),
        parseFloat(fixture.AwayWinOdds),
    ].filter(o => !isNaN(o));
    if (odds.length === 0) return { label: 'Unknown', color: 'bg-gray-200', textColor: 'text-gray-800' };
    const impliedProbability = 1 / Math.min(...odds);
    if (impliedProbability > 0.65) return { label: 'Easy', color: 'bg-green-200', textColor: 'text-green-800' };
    if (impliedProbability > 0.50) return { label: 'Medium', color: 'bg-yellow-200', textColor: 'text-yellow-800' };
    if (impliedProbability > 0.40) return { label: 'Hard', color: 'bg-orange-200', textColor: 'text-orange-800' };
    return { label: 'Very Hard', color: 'bg-red-200', textColor: 'text-red-800' };
}

// --- HTML GENERATION FUNCTIONS ---
function getKrakenHtml(krakenAnalysis, fixtureData, prefix = '') {
    if (!krakenAnalysis || !krakenAnalysis.ensProbs) return '<p class="text-red-500">Kraken data corrupted!</p>';
    const [ensH, ensD, ensA] = krakenAnalysis.ensProbs;
    const maxProb = Math.max(ensH, ensD, ensA);
    const leadingOutcome = ensH === maxProb ? 'Home' : (ensD === maxProb ? 'Draw' : 'Away');
    return `<div class="space-y-4">
        <div class="border-b-2 border-dashed border-amber-800 pb-2 mb-3">
            <h4 class="font-pirata text-lg">Kraken's Initial Forecast</h4>
            <p>${leadingOutcome} favored at ${Math.round(maxProb * 100)}%</p>
        </div>
        <div class="w-full bg-gray-200 rounded-full h-6 flex overflow-hidden">
            <div class="bg-blue-600 h-full" style="width: ${ensH * 100}%" title="Home: ${Math.round(ensH*100)}%"></div>
            <div class="bg-gray-500 h-full" style="width: ${ensD * 100}%" title="Draw: ${Math.round(ensD*100)}%"></div>
            <div class="bg-red-600 h-full" style="width: ${ensA * 100}%" title="Away: ${Math.round(ensA*100)}%"></div>
        </div>
    </div>`;
}

function getQuartermasterHtml(analysis, prefix = '') {
    if (!analysis || !analysis.tacticalBriefing) return '<p class="text-red-500">Quartermaster report missing!</p>';
    const briefingHtml = analysis.tacticalBriefing.split('\\n').map(p => `<p class="italic mb-2">${p.replace(/\*\*(.*?)\*\*/g, '<strong class="not-italic">$1</strong>').replace('::', ': ')}</p>`).join('');
    return `<div class="space-y-4">
        <div class="border-b-2 border-dashed border-amber-800 pb-2 mb-3"><h4 class="font-pirata text-lg">Quartermaster's Intelligence</h4></div>
        <div class="bg-white p-4 rounded border">${briefingHtml}</div>
    </div>`;
}

function getCaptainHtml(review, prefix = '') {
    if (!review || !review.finalProbabilities) return '<p class="text-red-500">Captain\'s orders missing!</p>';
    const { home, draw, away } = review.finalProbabilities;
    const synthesisHtml = (review.synthesis || '').split('\\n').map(p => `<p class="italic mb-2">${p.replace(/\*\*(.*?)\*\*/g, '<strong class="not-italic">$1</strong>').replace('::', ': ')}</p>`).join('');
    return `<div class="space-y-4 bg-amber-50 p-4 rounded-lg border-2 border-amber-200">
        <h4 class="font-bold text-lg font-pirata">⚓️ Captain's Final Orders</h4>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-center">
            <div class="bg-white p-2 rounded border"><p class="uppercase text-xs">Verdict</p><p class="font-bold">${review.finalVerdict}</p></div>
            <div class="bg-white p-2 rounded border"><p class="uppercase text-xs">Score</p><p class="font-bold">${review.predictedScoreline}</p></div>
            <div class="bg-white p-2 rounded border"><p class="uppercase text-xs">Confidence</p><p class="font-bold">${review.confidence}</p></div>
        </div>
        <div class="w-full bg-gray-200 rounded-full h-6 flex overflow-hidden">
             <div class="bg-blue-600 h-full" style="width: ${home * 100}%" title="Home: ${Math.round(home*100)}%"></div>
             <div class="bg-gray-500 h-full" style="width: ${draw * 100}%" title="Draw: ${Math.round(draw*100)}%"></div>
             <div class="bg-red-600 h-full" style="width: ${away * 100}%" title="Away: ${Math.round(away*100)}%"></div>
        </div>
        <div class="bg-white p-3 rounded-md border">${synthesisHtml}</div>
    </div>`;
}

function getStatisticalReasoningHtml(index, homeTeam, awayTeam, stats, prefix = '') {
    if (!stats) return '';
    const { homeElo, awayElo, homeOverallStats, awayOverallStats, h2hStats } = stats;
    const renderInsights = (insights) => insights.length === 0 ? '<li>• None identified</li>' : insights.map(i => `<li>• ${i}</li>`).join('');
    const homeInsights = [];
    const awayInsights = [];
    if (homeElo > awayElo + 25) homeInsights.push("Superior crew rating");
    if (awayElo > homeElo + 25) awayInsights.push("Superior crew rating");
    if (homeOverallStats && awayOverallStats) {
        if (homeOverallStats.formPoints > awayOverallStats.formPoints) homeInsights.push("Better recent form");
        if (awayOverallStats.formPoints > homeOverallStats.formPoints) awayInsights.push("Better recent form");
    }
    if (h2hStats && h2hStats.homeTeamWins > h2hStats.awayTeamWins) homeInsights.push("Advantage in head-to-head");
    if (h2hStats && h2hStats.awayTeamWins > h2hStats.homeTeamWins) awayInsights.push("Advantage in head-to-head");

    return `<div class="space-y-4">
        <div class="border-b-2 border-dashed border-amber-800 pb-2 mb-3"><h4 class="font-pirata text-lg">Key Statistical Insights</h4></div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><p class="font-semibold">${homeTeam}</p><ul class="mt-1 text-sm">${renderInsights(homeInsights)}</ul></div>
            <div><p class="font-semibold">${awayTeam}</p><ul class="mt-1 text-sm">${renderInsights(awayInsights)}</ul></div>
        </div>
        <div class="bg-gray-50 p-3 rounded-md border text-sm">
             <p><strong>Elo:</strong> ${Math.round(homeElo)} (${eloToGrade(homeElo, minEloRating, maxEloRating)}) vs ${Math.round(awayElo)} (${eloToGrade(awayElo, minEloRating, maxEloRating)})</p>
             <p><strong>H2H:</strong> ${h2hStats.homeTeamWins}W - ${h2hStats.draws}D - ${h2hStats.awayTeamWins}L</p>
        </div>
    </div>`;
}

function getUnlockedPredictionCardHtml(prediction, prefix = '') {
    const { fixture, krakenAnalysis, quartermasterReport, captainReview, result, userGuess } = prediction;
    const { HomeTeam: homeTeam, AwayTeam: awayTeam, MatchDate, id: uniqueIndex } = fixture;
    const formattedDate = new Date(MatchDate).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    const difficulty = getDifficultyRating(fixture);
    const isLocked = !!result; // A prediction is locked if it has a result

    let userGuessHtml = '';
    if (captainReview) { // Only show guess section after captain's review
        if (userGuess) {
            userGuessHtml = `<div class="bg-gray-200 p-3 rounded-md border text-center">
                <p class="font-bold text-gray-800 text-sm">Your Guess:</p>
                <p class="font-pirata text-2xl text-gray-900">${userGuess.home} - ${userGuess.away}</p>
            </div>`;
        } else if (!isLocked) {
            userGuessHtml = `<div class="bg-gray-100 p-3 rounded-md border">
                <p class="font-bold text-gray-800 text-sm mb-2 text-center">What's your call, Captain?</p>
                <div class="flex items-center justify-center gap-4">
                    <input type="number" id="${prefix}home-guess-${uniqueIndex}" class="w-16 text-center font-bold text-lg p-1 border rounded" min="0" value="1">
                    <span class="font-bold text-lg">-</span>
                    <input type="number" id="${prefix}away-guess-${uniqueIndex}" class="w-16 text-center font-bold text-lg p-1 border rounded" min="0" value="1">
                    <button data-prediction-id="${prediction.id}" data-index="${uniqueIndex}" data-prefix="${prefix}" class="save-guess-btn bg-green-700 hover:bg-green-800 text-white font-bold py-2 px-3 rounded-md text-xs">Lock In</button>
                </div>
            </div>`;
        }
    }
    
    let resultHtml = '';
    if (result) {
        resultHtml = `<div class="bg-yellow-100 border-2 border-yellow-300 p-3 rounded-md text-center">
             <p class="font-bold text-yellow-900 text-sm">Final Result:</p>
             <p class="font-pirata text-2xl text-yellow-900">${result.homeScore} - ${result.awayScore}</p>
        </div>`
    }

    return `<div class="p-4 bg-gray-50 rounded-lg font-medium">
        <div class="flex items-center justify-between gap-2">
            <div data-toggle-id="${prefix}${uniqueIndex}" class="toggle-details flex-grow cursor-pointer">
                <p class="font-bold text-lg">${homeTeam} vs ${awayTeam}</p>
                <p>${formattedDate}</p>
            </div>
            <div class="text-right">
                <span class="text-xs font-bold px-2 py-1 rounded-md ${difficulty.color} ${difficulty.textColor}">${difficulty.label}</span>
                <p class="text-xs text-gray-600 font-mono mt-1">H:${fixture.HomeWinOdds} D:${fixture.DrawOdds} A:${fixture.AwayWinOdds}</p>
            </div>
            <svg id="${prefix}toggle-icon-${uniqueIndex}" data-toggle-id="${prefix}${uniqueIndex}" class="toggle-details h-6 w-6 transition-transform duration-300 cursor-pointer" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
        </div>
        <div id="${prefix}toggle-content-${uniqueIndex}" class="hidden space-y-4 pt-4 mt-4 border-t">
            ${resultHtml}
            <div id="${prefix}prediction-${uniqueIndex}">${krakenAnalysis ? getKrakenHtml(krakenAnalysis, fixture) : ''}</div>
            <div id="${prefix}reasoning-${uniqueIndex}">${krakenAnalysis?.reasoningStats ? getStatisticalReasoningHtml(uniqueIndex, homeTeam, awayTeam, krakenAnalysis.reasoningStats) : ''}</div>
            <div class="text-center">${!krakenAnalysis && !isLocked ? `<button data-prediction-id="${prediction.id}" class="predict-btn svg-button"><svg width="120" height="50"><text x="60" y="32" font-family="Pirata One" font-size="24" fill="white" text-anchor="middle">Forecast</text></svg></button>` : ''}</div>
            <div id="${prefix}quartermaster-report-section-${uniqueIndex}">${quartermasterReport ? getQuartermasterHtml(quartermasterReport) : ''}</div>
            <div class="text-center">${krakenAnalysis && !quartermasterReport && !isLocked ? `<button data-prediction-id="${prediction.id}" class="quartermaster-btn svg-button"><svg width="240" height="50"><text x="120" y="33" font-family="Pirata One" font-size="24" fill="white" text-anchor="middle">Consult Quartermaster</text></svg></button>` : ''}</div>
            <div id="${prefix}captain-review-section-${uniqueIndex}">${captainReview ? getCaptainHtml(captainReview) : ''}</div>
            <div class="text-center">${quartermasterReport && !captainReview && !isLocked ? `<button data-prediction-id="${prediction.id}" class="captain-btn svg-button"><svg width="240" height="50"><text x="120" y="33" font-family="Pirata One" font-size="24" fill="white" text-anchor="middle">Get Captain's Orders</text></svg></button>` : ''}</div>
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
                .map(fixture => `<div class="flex items-center justify-between p-2 bg-gray-50 rounded-md border">
                    <div class="text-sm"><p class="font-bold text-gray-800">${fixture.HomeTeam} vs ${fixture.AwayTeam}</p><p class="text-xs text-gray-500">${new Date(fixture.MatchDate).toLocaleDateString()}</p></div>
                    <button data-fixture-id="${fixture.id}" class="unlock-btn bg-amber-700 text-white font-bold py-1 px-3 rounded-md text-xs">Unlock</button>
                </div>`).join('');
        } else {
            availableFixturesContainer.innerHTML = '<p class="text-gray-500 text-sm">All available skirmishes unlocked or none found.</p>';
        }
    }

    if (unlockedPredictionsContainer) {
        if (unlockedPredictions.length > 0) {
            unlockedPredictionsContainer.innerHTML = [...unlockedPredictions]
                .sort((a, b) => new Date(b.fixture.MatchDate) - new Date(a.fixture.MatchDate)) // Show most recent first
                .map(p => getUnlockedPredictionCardHtml(p)).join('');
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
        ledgerContainer.innerHTML = '<p class="text-center text-gray-700">No completed predictions to display.</p>';
        if(chartContainer) chartContainer.classList.add('hidden');
        if(learningsContent) learningsContent.innerHTML = '<p class="text-sm italic text-gray-700">No lessons learned yet.</p>';
        return;
    }

    const scores = { userHits: 0, captainHits: 0, krakenHits: 0, bookieHits: 0 };
    completed.forEach(p => {
        const { result, userGuess, captainReview, krakenAnalysis, fixture } = p;
        if (userGuess) {
            const userOutcome = userGuess.home > userGuess.away ? 'H' : (userGuess.away > userGuess.home ? 'A' : 'D');
            if (userOutcome === result.finalOutcome) scores.userHits++;
        }
        if (captainReview) {
            const verdict = captainReview.finalVerdict;
            const captainOutcome = verdict.includes('Draw') ? 'D' : (verdict.startsWith(fixture.HomeTeam) ? 'H' : 'A');
            if (captainOutcome === result.finalOutcome) scores.captainHits++;
        }
        if (krakenAnalysis) {
            const krakenProbs = krakenAnalysis.ensProbs;
            const krakenOutcome = ['H', 'D', 'A'][krakenProbs.indexOf(Math.max(...krakenProbs))];
            if (krakenOutcome === result.finalOutcome) scores.krakenHits++;
        }
        const odds = [parseFloat(fixture.HomeWinOdds), parseFloat(fixture.DrawOdds), parseFloat(fixture.AwayWinOdds)];
        const validOdds = odds.filter(o => !isNaN(o));
        if (validOdds.length > 0) {
            const bookieOutcome = ['H', 'D', 'A'][odds.indexOf(Math.min(...validOdds))];
            if (bookieOutcome === result.finalOutcome) scores.bookieHits++;
        }
    });

    ledgerContainer.innerHTML = `
        <div class="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
             <div class="p-2 bg-gray-200 rounded-md"><p class="font-bold">Your Hits</p><p class="font-pirata text-3xl">${scores.userHits}/${completed.length}</p></div>
             <div class="p-2 bg-gray-200 rounded-md"><p class="font-bold">Captain's Hits</p><p class="font-pirata text-3xl">${scores.captainHits}/${completed.length}</p></div>
             <div class="p-2 bg-gray-200 rounded-md"><p class="font-bold">Kraken's Hits</p><p class="font-pirata text-3xl">${scores.krakenHits}/${completed.length}</p></div>
             <div class="p-2 bg-gray-200 rounded-md"><p class="font-bold">Bookie's Hits</p><p class="font-pirata text-3xl">${scores.bookieHits}/${completed.length}</p></div>
        </div>
        <div class="overflow-x-auto">
            <table class="min-w-full bg-white">
                <thead class="bg-gray-800 text-white"><tr><th class="py-2 px-3">Fixture</th><th class="py-2 px-3">Result</th><th class="py-2 px-3">Captain</th><th class="py-2 px-3">You</th></tr></thead>
                <tbody>${[...completed].reverse().map(p => `<tr>
                    <td class="py-2 px-3 border-b">${p.fixture.HomeTeam} vs ${p.fixture.AwayTeam}</td>
                    <td class="py-2 px-3 border-b text-center">${p.result.homeScore} - ${p.result.awayScore}</td>
                    <td class="py-2 px-3 border-b text-center">${p.captainReview?.predictedScoreline.match(/(\\d+ - \\d+)/)?.[0] || 'N/A'}</td>
                    <td class="py-2 px-3 border-b text-center">${p.userGuess ? `${p.userGuess.home} - ${p.userGuess.away}` : 'N/A'}</td>
                </tr>`).join('')}</tbody>
            </table>
        </div>`;
        
    // Render Chart
    if (chartContainer) chartContainer.classList.remove('hidden');
    const ctx = safeGetElement('success-rate-chart');
    if (ctx) {
        if (successChart) successChart.destroy();
        successChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Your Hits', "Captain's Hits", "Kraken's Hits", "Bookie's Hits"],
                datasets: [{ data: [scores.userHits, scores.captainHits, scores.krakenHits, scores.bookieHits] }]
            }
        });
    }
}

// --- MODAL & EVENT LISTENERS ---
function toggleFixtureDetails(toggleId) {
    if (!toggleId) return;
    const content = safeGetElement(`toggle-content-${toggleId}`);
    const icon = safeGetElement(`toggle-icon-${toggleId}`);
    if (content) content.classList.toggle('hidden');
    if (icon) icon.style.transform = content.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)';
}

export function initializeToggleListeners() {
    document.addEventListener('click', (e) => {
        const toggleDetailsElement = e.target.closest('.toggle-details');
        if (toggleDetailsElement && toggleDetailsElement.dataset.toggleId) {
            toggleFixtureDetails(toggleDetailsElement.dataset.toggleId);
        }
    });
}
