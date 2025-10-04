// ui.js (New Version - No Auth, Local Features)

import { allFoundFixtures, unlockedPredictions, trainedLeagueCode } from './main.js';

// --- CONSTANTS & MODULE STATE ---
const LOTTIE_LOADER_HTML = `<dotlottie-wc src="https://lottie.host/19109b73-f99a-4a89-a48c-d5b90bf22b22/tlVX1kmiPt.lottie" background="transparent" speed="1" style="width: 40px; height: 40px;" loop autoplay></dotlottie-wc>`;
let minEloRating, maxEloRating;

// Safe DOM helper functions
function safeGetElement(id) {
    const element = document.getElementById(id);
    if (!element) {
        console.warn(`Element with id '${id}' not found`);
    }
    return element;
}

function safeUpdateElement(id, content) {
    const element = safeGetElement(id);
    if (element) {
        element.innerHTML = content;
    }
    return element;
}

function safeToggleClass(id, className, condition) {
    const element = safeGetElement(id);
    if (element) {
        element.classList.toggle(className, condition);
    }
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
    if (normalized > 0.95) return 'A+';
    if (normalized > 0.85) return 'A';
    if (normalized > 0.75) return 'A-';
    if (normalized > 0.65) return 'B+';
    if (normalized > 0.55) return 'B';
    if (normalized > 0.45) return 'B-';
    if (normalized > 0.35) return 'C+';
    if (normalized > 0.25) return 'C';
    if (normalized > 0.15) return 'C-';
    return 'D';
}

function getDifficultyRating(fixture) {
    if (!fixture) {
        return { label: 'Unknown', color: 'bg-gray-200', textColor: 'text-gray-800' };
    }

    const { HomeWinOdds, DrawOdds, AwayWinOdds } = fixture;

    const oddsAsNumbers = [
        HomeWinOdds !== 'N/A' ? parseFloat(HomeWinOdds) : NaN,
        DrawOdds !== 'N/A' ? parseFloat(DrawOdds) : NaN,
        AwayWinOdds !== 'N/A' ? parseFloat(AwayWinOdds) : NaN,
    ].filter((o) => !isNaN(o));

    if (oddsAsNumbers.length === 0) {
        return { label: 'Unknown', color: 'bg-gray-200', textColor: 'text-gray-800' };
    }

    const lowestOdd = Math.min(...oddsAsNumbers);
    const impliedProbability = 1 / lowestOdd;

    if (impliedProbability > 0.65) {
        return { label: 'Easy', color: 'bg-green-200', textColor: 'text-green-800' };
    }
    if (impliedProbability > 0.50) {
        return { label: 'Medium', color: 'bg-yellow-200', textColor: 'text-yellow-800' };
    }
    if (impliedProbability > 0.40) {
        return { label: 'Hard', color: 'bg-orange-200', textColor: 'text-orange-800' };
    }
    return { label: 'Very Hard', color: 'bg-red-200', textColor: 'text-red-800' };
}

function getDifficultyMultiplier(difficultyLabel) {
    switch (difficultyLabel) {
        case 'Easy':
            return 1.0;
        case 'Medium':
            return 1.5;
        case 'Hard':
            return 2.0;
        case 'Very Hard':
            return 2.5;
        default:
            return 1.0;
    }
}

function getModelAgreement(nn, lr, poi) {
    const predictions = [nn, lr, poi];
    const maxSpread = Math.max(...predictions) - Math.min(...predictions);
    if (maxSpread < 0.15) return "strongly agree";
    if (maxSpread < 0.25) return "generally agree";
    return "disagree significantly";
}

function getConfidenceExplanation(home, draw, away) {
    const maxProb = Math.max(home, draw, away);
    const secondProb = [home, draw, away].sort((a, b) => b - a)[1];
    const spread = maxProb - secondProb;
    if (spread > 0.20) return "High confidence prediction.";
    if (spread > 0.10) return "Moderate confidence prediction.";
    return "Low confidence - very close contest predicted.";
}

function getOddsWarning(odds) {
    if (!odds || odds.homeWin === 'N/A') return '';
    const homeOdds = parseFloat(odds.homeWin);
    const awayOdds = parseFloat(odds.awayWin);
    if (isNaN(homeOdds) || isNaN(awayOdds)) return '';
    if (homeOdds < 1.5 || awayOdds < 1.5) {
        return '<p>⚠️ Market sees clear favorite - upset potential</p>';
    }
    return '';
}

function checkPredictionConsistency(krakenAnalysis, captainReview) {
    if (!krakenAnalysis || !captainReview) return '';
    const krakenLeading = Math.max(...krakenAnalysis.ensProbs);
    const captainLeading = Math.max(captainReview.finalProbabilities.home, captainReview.finalProbabilities.draw, captainReview.finalProbabilities.away);
    const disagreement = Math.abs(krakenLeading - captainLeading) > 0.25;
    if (disagreement) {
        return `<div class="mt-3 p-3 bg-red-50 border border-red-200 rounded-md"><p>⚠️ Significant Model Disagreement</p><p>The Captain's final assessment differs substantially from the statistical models. Review reasoning carefully.</p></div>`;
    }
    return '';
}

function getKrakenHtml(krakenAnalysis, prefix = '', fixtureData) {
    if (!krakenAnalysis || !krakenAnalysis.ensProbs || !Array.isArray(krakenAnalysis.ensProbs)) {
        return '<p class="text-red-500">Kraken data corrupted!</p>';
    }

    const { homeTeam, awayTeam, index, predictionId, isLocked, isLeagueMismatch } = fixtureData;
    const [ensH, ensD, ensA] = krakenAnalysis.ensProbs;
    const [nnH, nnD, nnA] = krakenAnalysis.nnProbs || [0, 0, 0];
    const [lrH, lrD, lrA] = krakenAnalysis.lrProbs || [0, 0, 0];
    const [poiH, poiD, poiA] = krakenAnalysis.poissonProbs || [0, 0, 0];
    const maxProb = Math.max(ensH, ensD, ensA);
    const leadingOutcome = ensH === maxProb ? 'Home' : (ensD === maxProb ? 'Draw' : 'Away');
    const uniqueId = krakenAnalysis.reasoningStats?.homeElo || Date.now();

    const weights = krakenAnalysis.settingsUsed || { nnWeight: 40, lrWeight: 25, poissonWeight: 35 };
    const weightsText = `This forecast combined models using these weights: Neural: ${weights.nnWeight}%, Logistic: ${weights.lrWeight}%, Poisson: ${weights.poissonWeight}%.`;

    let reforecastButtonHtml = '';
    if (!isLocked) {
        const isDisabled = isLeagueMismatch;
        const title = isLeagueMismatch 
            ? `Kraken is trained for a different league! Please re-train on the correct league data first.`
            : `Re-run the forecast using your custom settings from the Kraken's Helm.`;

        reforecastButtonHtml = `
            <button 
                data-hometeam="${homeTeam}" 
                data-awayteam="${awayTeam}" 
                data-index="${index}" 
                data-prediction-id="${predictionId}" 
                class="reforecast-btn bg-blue-700 hover:bg-blue-800 text-white font-bold py-1 px-4 text-xs rounded-md ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}"
                ${isDisabled ? 'disabled' : ''}
                title="${title}">
                Re-Forecast with Helm Settings
            </button>
        `;
    }

    return `<div class="space-y-4">
                <div class="border-b-2 border-dashed border-amber-800 pb-2 mb-3">
                    <div class="flex items-center justify-between">
                        <div>
                            <h4 class="font-pirata text-lg">Kraken's Initial Forecast</h4>
                            <p>${leadingOutcome} favored at ${Math.round(maxProb*100)}%</p>
                        </div>
                        <div class="text-right">
                            <button class="kraken-details-toggle text-sm text-blue-800 hover:underline" data-target="${prefix}kraken-details-${uniqueId}">Show Details ↓</button>
                        </div>
                    </div>
                </div>
                <div class="space-y-2">
                    <div class="w-full bg-gray-200 rounded-full h-6 flex overflow-hidden border border-gray-300 text-white text-sm font-bold items-center shadow-sm" title="Kraken's Call: H ${Math.round(ensH*100)}% | D ${Math.round(ensD*100)}% | A ${Math.round(ensA*100)}%">
                        <div class="bg-blue-600 h-full flex items-center justify-center transition-all duration-500" style="width: ${ensH * 100}%">${Math.round(ensH*100)}%</div>
                        <div class="bg-gray-500 h-full flex items-center justify-center transition-all duration-500" style="width: ${ensD * 100}%">${Math.round(ensD*100)}%</div>
                        <div class="bg-red-600 h-full flex items-center justify-center transition-all duration-500" style="width: ${ensA * 100}%">${Math.round(ensA*100)}%</div>
                    </div>
                    <div class="flex justify-between text-sm"><span>Home Win</span><span>Draw</span><span>Away Win</span></div>
                </div>
                <div class="text-center mt-2">
                   ${reforecastButtonHtml}
                </div>
                <div id="${prefix}kraken-details-${uniqueId}" class="hidden space-y-3 pt-3 border-t border-gray-200">
                    <h5>Model Breakdown</h5>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                        <div class="bg-gray-50 p-3 rounded-md border"><p>Neural Network</p><p class="text-xs">Deep pattern recognition</p><p class="font-mono mt-1">${Math.round(nnH*100)}% | ${Math.round(nnD*100)}% | ${Math.round(nnA*100)}%</p></div>
                        <div class="bg-gray-50 p-3 rounded-md border"><p>Logistic Regression</p><p class="text-xs">Linear relationships</p><p class="font-mono mt-1">${Math.round(lrH*100)}% | ${Math.round(lrD*100)}% | ${Math.round(lrA*100)}%</p></div>
                        <div class="bg-gray-50 p-3 rounded-md border"><p>Poisson Model</p><p class="text-xs">Goal-based probabilities</p><p class="font-mono mt-1">${Math.round(poiH*100)}% | ${Math.round(poiD*100)}% | ${Math.round(poiA*100)}%</p></div>
                    </div>
                    <div class="bg-gray-50 p-2 rounded text-sm"><p class="font-semibold mb-1">Model Agreement Analysis:</p><p>Models ${getModelAgreement(nnH, lrH, poiH)} on the outcome. ${getConfidenceExplanation(ensH, ensD, ensA)}</p><p class="italic mt-1 text-xs">${weightsText}</p></div>
                </div>
            </div>`;
}

function getQuartermasterHtml(analysis, prefix = '') {
    if (!analysis || !analysis.tacticalBriefing) {
        return '<p class="text-red-500">Quartermaster report missing or corrupted!</p>';
    }

    const briefingHtml = analysis.tacticalBriefing
        .split('\n')
        .filter(p => p.trim() !== '')
        .map(paragraph => {
            const parts = paragraph.split('::');
            const header = parts.length > 1 ? parts[0].replace(/\*\*/g, '').trim() : '';
            const content = parts.length > 1 ? parts[1].trim() : parts[0].trim();
            
            return `<div>
                        <h5 class="font-bold text-gray-800">${header}</h5>
                        <p class="italic leading-relaxed text-gray-700 mb-2">${content}</p>
                    </div>`;
        })
        .join('');

    return `<div class="space-y-4">
                <div class="border-b-2 border-dashed border-amber-800 pb-2 mb-3">
                    <h4 class="font-pirata text-lg">Quartermaster's Intelligence</h4>
                </div>
                <div class="bg-white p-4 rounded border border-gray-200 shadow-sm space-y-2">
                    ${briefingHtml}
                </div>
            </div>`;
}

function getCaptainHtml(review, uniqueId, prefix = '') {
    if (!review || !review.finalProbabilities) {
        return '<p class="text-red-500">Captain\'s orders missing!</p>';
    }

    let confidenceIcon = '⚓';
    if (review.confidence === 'Sure as the Tides') confidenceIcon = '🌊';
    else if (review.confidence === 'Favourable Winds') confidenceIcon = '⛵';
    else if (review.confidence === 'Choppy Waters') confidenceIcon = '🌊';
    else if (review.confidence === 'Against the Wind') confidenceIcon = '💨';
    else if (review.confidence === 'A Long Shot for the Loot') confidenceIcon = '🎲';

    const { home, draw, away } = review.finalProbabilities;

    const synthesisHtml = (review.synthesis || '**Musings**::The winds are unclear...')
        .split('\n')
        .filter(p => p.trim() !== '')
        .map(paragraph => {
            const parts = paragraph.split('::');
            const header = parts.length > 1 ? parts[0].replace(/\*\*/g, '').trim() : '';
            const content = parts.length > 1 ? parts[1].trim() : parts[0].trim();
            
            return `<div class="mb-2">
                        <p class="font-semibold text-gray-800">${header}</p>
                        <p class="italic leading-relaxed text-gray-700">${content}</p>
                    </div>`;
        })
        .join('');

    return `<div class="space-y-4 bg-gradient-to-r from-yellow-50 to-amber-50 p-4 rounded-lg border-2 border-amber-200 shadow-md">
                <div class="bg-amber-500 bg-opacity-20 border-2 border-amber-400 p-4 rounded-lg">
                    <h4 class="font-bold text-lg font-pirata tracking-wide flex items-center">⚔️ Captain's Final Orders</h4>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                        <div class="text-center bg-white p-3 rounded border border-amber-200 shadow-sm">
                            <p class="uppercase tracking-wider">Verdict</p>
                            <p class="text-lg font-bold">${review.finalVerdict || 'Undecided'}</p>
                        </div>
                        <div class="text-center bg-white p-3 rounded border border-amber-200 shadow-sm">
                            <p class="uppercase tracking-wider">Score</p>
                            <p class="text-lg font-bold">${review.predictedScoreline || 'TBD'}</p>
                        </div>
                        <div class="text-center bg-white p-3 rounded border border-amber-200 shadow-sm">
                            <p class="uppercase tracking-wider">Confidence</p>
                            <p class="text-lg font-bold">${confidenceIcon} ${review.confidence || 'Unknown'}</p>
                        </div>
                    </div>
                    <div class="mt-4 space-y-2">
                        <p class="font-bold uppercase tracking-wider text-center">Final Adjusted Probability</p>
                        <div class="w-full bg-gray-200 rounded-full h-6 flex overflow-hidden border-2 border-amber-300 text-white text-sm font-bold items-center shadow-sm">
                            <div class="bg-blue-600 h-full flex items-center justify-center transition-all duration-700" style="width: ${(home || 0) * 100}%">${Math.round((home || 0)*100)}%</div>
                            <div class="bg-gray-600 h-full flex items-center justify-center transition-all duration-700" style="width: ${(draw || 0) * 100}%">${Math.round((draw || 0)*100)}%</div>
                            <div class="bg-red-600 h-full flex items-center justify-center transition-all duration-700" style="width: ${(away || 0) * 100}%">${Math.round((away || 0)*100)}%</div>
                        </div>
                        <div class="flex justify-between"><span>Home Win</span><span>Draw</span><span>Away Win</span></div>
                    </div>
                </div>
                <div class="text-center">
                    <button class="captain-details-toggle" data-target="${prefix}captain-details-${uniqueId}">Read Captain's Full Analysis ↓</button>
                </div>
                <div id="${prefix}captain-details-${uniqueId}" class="hidden space-y-3">
                    <div class="bg-white p-4 rounded-md border border-amber-200 space-y-2">
                        ${synthesisHtml}
                    </div>
                </div>
            </div>`;
}

function getStatisticalReasoningHtml(index, homeTeam, awayTeam, stats, prefix = '') {
    if (!stats) {
        return '';
    }

    const { homeStats, awayStats, h2hStats, homeOverallStats, awayOverallStats, homeElo, awayElo } = stats;

    const homeInsights = [];
    const awayInsights = [];

    const eloDiff = (homeElo || 1500) - (awayElo || 1500);
    if (eloDiff >= 50) homeInsights.push(`Superior crew rating (+${Math.round(eloDiff)})`);
    else if (eloDiff <= -50) awayInsights.push(`Superior crew rating (+${Math.round(Math.abs(eloDiff))})`);

    if (homeOverallStats && awayOverallStats) {
        const formDiff = (homeOverallStats.formPoints - awayOverallStats.formPoints) * 15;
        if (formDiff >= 2) homeInsights.push('Better recent form');
        else if (formDiff <= -2) awayInsights.push('Better recent form');

        const attackDiff = homeOverallStats.avgGoalsScored - awayOverallStats.avgGoalsScored;
        if (attackDiff >= 0.2) homeInsights.push('More potent attack');
        else if (attackDiff <= -0.2) awayInsights.push('More potent attack');

        const defenseDiff = homeOverallStats.avgGoalsConceded - awayOverallStats.avgGoalsConceded;
        if (defenseDiff <= -0.2) homeInsights.push('Stronger defensive record');
        else if (defenseDiff >= 0.2) awayInsights.push('Stronger defensive record');
    }

    if (h2hStats) {
        if (h2hStats.homeTeamWins > h2hStats.awayTeamWins) homeInsights.push('Advantage in head-to-head');
        else if (h2hStats.awayTeamWins > h2hStats.homeTeamWins) awayInsights.push('Advantage in head-to-head');
    }

    const renderInsights = (insights) => {
        if (insights.length === 0) return '<li>• None identified</li>';
        return insights.map((i) => `<li>• ${i}</li>`).join('');
    };

    return `<div class="space-y-4">
                    <div class="border-b-2 border-dashed border-amber-800 pb-2 mb-3">
                        <div class="flex items-center justify-between">
                            <h4 class="font-pirata text-lg">Key Statistical Insights</h4>
                            <button class="stats-details-toggle" data-target="${prefix}stats-details-${index}">Show Details ↓</button>
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <p class="font-semibold">${homeTeam || 'Home Team'}</p>
                            <ul class="mt-1 text-sm">${renderInsights(homeInsights)}</ul>
                        </div>
                        <div>
                            <p class="font-semibold">${awayTeam || 'Away Team'}</p>
                            <ul class="mt-1 text-sm">${renderInsights(awayInsights)}</ul>
                        </div>
                    </div>

                    ${h2hStats && h2hStats.totalMatches > 0 ? `<p class="mt-2 text-sm"><strong>Recent History:</strong> ${h2hStats.homeTeamWins}W-${h2hStats.draws}D-${h2hStats.awayTeamWins}L in last ${h2hStats.totalMatches} meetings</p>` : ''}
                    
                    <div id="${prefix}stats-details-${index}" class="hidden space-y-3">
                        <div class="bg-gray-50 p-3 rounded-md border">
                            <h5 class="font-semibold mb-2">Crew Ratings & Form</h5>
                            <div class="grid grid-cols-3 gap-2 text-center">
                                <div class="font-medium">Metric</div>
                                <div class="font-medium">${(homeTeam || 'Home').substring(0, 12)}</div>
                                <div class="font-medium">${(awayTeam || 'Away').substring(0, 12)}</div>
                                <div class="bg-white p-1 rounded">Elo Rating</div>
                                <div class="bg-white p-1 rounded">${Math.round(homeElo || 1500)} <span class="font-bold text-blue-600">${eloToGrade(homeElo || 1500, minEloRating || 1200, maxEloRating || 1800)}</span></div>
                                <div class="bg-white p-1 rounded">${Math.round(awayElo || 1500)} <span class="font-bold text-red-600">${eloToGrade(awayElo || 1500, minEloRating || 1200, maxEloRating || 1800)}</span></div>
                                ${homeOverallStats && awayOverallStats ? `
                                <div class="bg-white p-1 rounded">Overall Form</div>
                                <div class="bg-white p-1 rounded">${Math.round(homeOverallStats.formPoints * 15)}/15 pts</div>
                                <div class="bg-white p-1 rounded">${Math.round(awayOverallStats.formPoints * 15)}/15 pts</div>
                                ${homeStats && awayStats ? `
                                <div class="bg-white p-1 rounded">Venue Form</div>
                                <div class="bg-white p-1 rounded">${Math.round(homeStats.formPoints * 15)}/15 pts</div>
                                <div class="bg-white p-1 rounded">${Math.round(awayStats.formPoints * 15)}/15 pts</div>
                                ` : ''}
                                <div class="bg-white p-1 rounded">Avg Goals</div>
                                <div class="bg-white p-1 rounded">${homeOverallStats.avgGoalsScored.toFixed(1)}</div>
                                <div class="bg-white p-1 rounded">${awayOverallStats.avgGoalsScored.toFixed(1)}</div>
                                <div class="bg-white p-1 rounded">Defensive Record</div>
                                <div class="bg-white p-1 rounded">${homeOverallStats.avgGoalsConceded.toFixed(1)} conceded</div>
                                <div class="bg-white p-1 rounded">${awayOverallStats.avgGoalsConceded.toFixed(1)} conceded</div>
                                ` : '<div class="col-span-3 text-center text-gray-500">Statistical data unavailable</div>'}
                            </div>
                        </div>
                        <div class="bg-gray-50 p-2 rounded">
                            <p><strong>Elo Explanation:</strong> Chess-style rating system where higher = stronger. A-grade teams (1650+) are title contenders.</p>
                            <p><strong>Form Points:</strong> Points earned from last 5 matches (15 = perfect record).</p>
                        </div>
                    </div>
                </div>`;
}

export function displayStatisticalReasoning(index, homeTeam, awayTeam, stats, prefix = '') {
    const html = getStatisticalReasoningHtml(index, homeTeam, awayTeam, stats, prefix);
    const reasoningEl = safeGetElement(`${prefix}reasoning-${index}`);
    if (reasoningEl) {
        reasoningEl.innerHTML = html;
    }
}

function getUnlockedPredictionCardHtml(prediction, prefix = '') {
    if (!prediction || !prediction.fixture) {
        return '<div class="p-4 bg-red-50 rounded-lg"><p class="text-red-600">Invalid prediction data</p></div>';
    }

    const { fixture, krakenAnalysis, quartermasterReport, captainReview } = prediction;
    const { HomeTeam: homeTeam, AwayTeam: awayTeam, MatchDate, id: uniqueIndex } = fixture;

    if (!homeTeam || !awayTeam || !MatchDate) {
        return '<div class="p-4 bg-red-50 rounded-lg"><p class="text-red-600">Incomplete fixture data</p></div>';
    }

    const dateObj = new Date(MatchDate);
    dateObj.setUTCHours(12);
    const formattedDate = dateObj.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

    const difficulty = getDifficultyRating(fixture);
    const oddsHtml = `
        <div class="text-right">
            <span class="text-xs font-bold px-2 py-1 rounded-md ${difficulty.color} ${difficulty.textColor}">${difficulty.label}</span>
            <p class="text-xs text-gray-600 font-mono mt-1">H:${fixture.HomeWinOdds} D:${fixture.DrawOdds} A:${fixture.AwayWinOdds}</p>
        </div>
    `;

    const isLocked = !!quartermasterReport;
    const isLeagueMismatch = trainedLeagueCode && fixture.leagueCode && trainedLeagueCode !== fixture.leagueCode;

    const fixtureDataForKraken = {
        homeTeam: homeTeam,
        awayTeam: awayTeam,
        index: uniqueIndex,
        predictionId: prediction.id,
        isLocked: isLocked,
        isLeagueMismatch: isLeagueMismatch,
    };

    const krakenHtml = krakenAnalysis ? getKrakenHtml(krakenAnalysis, prefix, fixtureDataForKraken) : '';

    const reasoningHtml = (krakenAnalysis && krakenAnalysis.reasoningStats)
        ? getStatisticalReasoningHtml(uniqueIndex, krakenAnalysis.officialHomeTeam, krakenAnalysis.officialAwayTeam, krakenAnalysis.reasoningStats, prefix)
        : '';

    const quartermasterHtml = quartermasterReport ? getQuartermasterHtml(quartermasterReport, prefix) : '';
    let captainHtml = captainReview ? getCaptainHtml(captainReview, uniqueIndex, prefix) : '';

    if (krakenAnalysis && captainReview) {
        captainHtml += checkPredictionConsistency(krakenAnalysis, captainReview);
    }

    const userGuessHtml = captainReview ?
        prediction.userGuess ?
        `<div class="bg-gray-200 p-3 rounded-md border text-center">
                    <p class="font-bold text-gray-800 text-sm">Your Guess:</p>
                    <p class="font-pirata text-2xl text-gray-900">${prediction.userGuess.home} - ${prediction.userGuess.away}</p>
                </div>` :
        `<div class="bg-gray-100 p-3 rounded-md border">
                    <p class="font-bold text-gray-800 text-sm mb-2 text-center">What's your call, Captain?</p>
                    <div class="flex items-center justify-center gap-4">
                        <input type="number" id="${prefix}home-guess-${uniqueIndex}" class="w-16 text-center font-bold text-lg p-1 border rounded" min="0" value="1">
                        <span class="font-bold text-lg">-</span>
                        <input type="number" id="${prefix}away-guess-${uniqueIndex}" class="w-16 text-center font-bold text-lg p-1 border rounded" min="0" value="1">
                        <button data-prediction-id="${prediction.id}" data-index="${uniqueIndex}" data-prefix="${prefix}" class="save-guess-btn bg-green-700 hover:bg-green-800 text-white font-bold py-2 px-3 rounded-md text-xs">Lock In</button>
                    </div>
                </div>` :
        '';

    return `<div class="p-4 bg-gray-50 rounded-lg font-medium">
        <div class="flex items-center justify-between gap-2">
            <div data-toggle-id="${prefix}${uniqueIndex}" class="toggle-details text-center sm:text-left flex-grow cursor-pointer">
                <p class="font-bold text-lg">${homeTeam} vs ${awayTeam}</p>
                <p>${formattedDate}</p>
            </div>
            
            ${oddsHtml}

            <div class="flex items-center gap-2">
                ${!krakenAnalysis ? `<button data-hometeam="${homeTeam}" data-awayteam="${awayTeam}" data-index="${uniqueIndex}" data-prediction-id="${prediction.id}" class="predict-btn svg-button">
                    <svg width="120" height="50" viewBox="0 0 120 50">
                        <defs>
                            <filter id="woodTextureForecast${uniqueIndex}">
                                <feTurbulence type="fractalNoise" baseFrequency="0.02 0.2" numOctaves="3" result="noise"/>
                                <feDiffuseLighting in="noise" lighting-color="#a07a5f" surfaceScale="2">
                                    <feDistantLight azimuth="45" elevation="60"/>
                                </feDiffuseLighting>
                                <feComposite operator="in" in2="SourceGraphic" result="textured"/>
                            </filter>
                        </defs>
                        <path d="M2,5 Q0,25 2,45 L118,48 Q120,25 118,2 Z" fill="#D2691E" stroke="#5a2d0c" stroke-width="2"/>
                        <path d="M2,5 Q0,25 2,45 L118,48 Q120,25 118,2 Z" fill="#D2691E" filter="url(#woodTextureForecast${uniqueIndex})" opacity="0.4"/>
                        <text x="60" y="32" font-family="Pirata One, cursive" font-size="24" fill="white" text-anchor="middle" style="paint-order: stroke; stroke: #000; stroke-width: 1px;">Forecast</text>
                    </svg>
                </button>` : ''}
                <svg id="${prefix}toggle-icon-${uniqueIndex}" data-toggle-id="${prefix}${uniqueIndex}" class="toggle-details h-6 w-6 transition-transform duration-300 cursor-pointer" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
            </div>
        </div>
        <div id="${prefix}toggle-content-${uniqueIndex}" class="hidden space-y-4 pt-4 mt-4 border-t border-gray-200">
            <div id="${prefix}prediction-${uniqueIndex}">${krakenHtml}</div>
            <div id="${prefix}reasoning-${uniqueIndex}">${reasoningHtml}</div>
            <div id="${prefix}quartermaster-report-btn-container-${uniqueIndex}" class="mt-2 text-center ${krakenAnalysis && !quartermasterReport ? '' : 'hidden'}">
                <button data-hometeam="${homeTeam}" data-awayteam="${awayTeam}" data-index="${uniqueIndex}" data-prediction-id="${prediction.id}" class="quartermaster-btn svg-button mx-auto">
                    <svg width="240" height="50" viewBox="0 0 240 50">
                        <defs>
                            <filter id="woodTextureQM${uniqueIndex}">
                                <feTurbulence type="fractalNoise" baseFrequency="0.02 0.2" numOctaves="3" result="noise"/>
                                <feDiffuseLighting in="noise" lighting-color="#a07a5f" surfaceScale="2">
                                    <feDistantLight azimuth="45" elevation="60"/>
                                </feDiffuseLighting>
                                <feComposite operator="in" in2="SourceGraphic" result="textured"/>
                            </filter>
                        </defs>
                        <path d="M2,5 Q0,25 2,45 L238,48 Q240,25 238,2 Z" fill="#D2691E" stroke="#5a2d0c" stroke-width="2"/>
                        <path d="M2,5 Q0,25 2,45 L238,48 Q240,25 238,2 Z" fill="#D2691E" filter="url(#woodTextureQM${uniqueIndex})" opacity="0.4"/>
                        <text x="120" y="33" font-family="Pirata One, cursive" font-size="24" fill="white" text-anchor="middle" style="paint-order: stroke; stroke: #000; stroke-width: 1px;">Consult Quartermaster</text>
                    </svg>
                </button>
            </div>
            <div id="${prefix}quartermaster-report-section-${uniqueIndex}">${quartermasterHtml}</div>
            <div id="${prefix}captain-review-btn-container-${uniqueIndex}" class="mt-2 text-center ${quartermasterReport && !captainReview ? '' : 'hidden'}">
                <button data-hometeam="${homeTeam}" data-awayteam="${awayTeam}" data-index="${uniqueIndex}" data-prediction-id="${prediction.id}" class="captain-btn svg-button mx-auto">
                    <svg width="240" height="50" viewBox="0 0 240 50">
                        <defs>
                            <filter id="woodTextureCaptain${uniqueIndex}">
                                <feTurbulence type="fractalNoise" baseFrequency="0.02 0.2" numOctaves="3" result="noise"/>
                                <feDiffuseLighting in="noise" lighting-color="#a07a5f" surfaceScale="2">
                                    <feDistantLight azimuth="45" elevation="60"/>
                                </feDiffuseLighting>
                                <feComposite operator="in" in2="SourceGraphic" result="textured"/>
                            </filter>
                        </defs>
                        <path d="M2,5 Q0,25 2,45 L238,48 Q240,25 238,2 Z" fill="#D2691E" stroke="#5a2d0c" stroke-width="2"/>
                        <path d="M2,5 Q0,25 2,45 L238,48 Q240,25 238,2 Z" fill="#D2691E" filter="url(#woodTextureCaptain${uniqueIndex})" opacity="0.4"/>
                        <text x="120" y="33" font-family="Pirata One, cursive" font-size="24" fill="white" text-anchor="middle" style="paint-order: stroke; stroke: #000; stroke-width: 1px;">Get Captain's Orders</text>
                    </svg>
                </button>
            </div>
            <div id="${prefix}captain-review-section-${uniqueIndex}">${captainHtml}</div>
            <div id="${prefix}user-guess-section-${uniqueIndex}" class="mt-4">${userGuessHtml}</div>
        </div>
    </div>`;
}

// ui.js -> REPLACE THIS FUNCTION
export function renderFixtureUI() {
    const availableFixturesContainer = safeGetElement('available-fixtures-container');
    const unlockedPredictionsContainer = safeGetElement('unlocked-predictions-container');
    const unlockedPredictionsSection = safeGetElement('unlocked-predictions-section');

    // Store open card states
    const openCardIds = new Set();
    if (unlockedPredictionsContainer) {
        const openContents = unlockedPredictionsContainer.querySelectorAll('[id^="toggle-content-"]:not(.hidden)');
        openContents.forEach((content) => {
            const toggleId = content.id.replace('toggle-content-', '');
            openCardIds.add(toggleId);
        });
    }

    const unlockedFixtureIds = new Set(
        unlockedPredictions.map(p => p.fixture?.id).filter(Boolean)
    );

    const availableFixtures = allFoundFixtures.filter(f => f.id && !unlockedFixtureIds.has(f.id));

    // Render available fixtures
    if (availableFixturesContainer) {
        if (availableFixtures.length > 0) {
            const fixturesHtml = availableFixtures
                .sort((a, b) => new Date(a.MatchDate) - new Date(b.MatchDate))
                .map((fixture) => {
                    const dateObj = new Date(fixture.MatchDate);
                    dateObj.setUTCHours(12);
                    const formattedDate = dateObj.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

                    // This is the new, cleaner HTML without odds or difficulty
                    return `<div class="flex items-center justify-between p-3 bg-gray-50 rounded-md border">
                                <div class="text-sm">
                                    <p class="font-bold text-gray-800">${fixture.HomeTeam || 'Unknown'} vs ${fixture.AwayTeam || 'Unknown'}</p>
                                    <p class="text-gray-600">${formattedDate}</p>
                                </div>
                                <button data-fixture-id="${fixture.id}" class="unlock-btn bg-amber-700 hover:bg-amber-800 text-white font-bold py-1 px-3 rounded-md text-sm whitespace-nowrap">Unlock</button>
                            </div>`;
                }).join('');
            availableFixturesContainer.innerHTML = fixturesHtml;
        } else {
            availableFixturesContainer.innerHTML = '<p class="text-gray-500 text-sm">All available skirmishes have been unlocked or none were found.</p>';
        }
    }

    // Render unlocked predictions
    if (unlockedPredictionsContainer && unlockedPredictionsSection) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const upcomingPredictions = unlockedPredictions.filter(p => {
            if (!p.fixture || !p.fixture.MatchDate) return false;
            const matchDate = new Date(p.fixture.MatchDate);
            return matchDate >= today;
        });

        if (upcomingPredictions.length > 0) {
            safeToggleClass('unlocked-predictions-section', 'hidden', false);
            const predictionsHtml = upcomingPredictions
                .sort((a, b) => new Date(a.fixture.MatchDate) - new Date(b.fixture.MatchDate))
                .map((p) => getUnlockedPredictionCardHtml(p, '')).join('');
            unlockedPredictionsContainer.innerHTML = predictionsHtml;
        } else {
            safeToggleClass('unlocked-predictions-section', 'hidden', true);
        }
    }

    // Restore open card states
    openCardIds.forEach((toggleId) => {
        const content = safeGetElement(`toggle-content-${toggleId}`);
        const icon = safeGetElement(`toggle-icon-${toggleId}`);
        if (content && content.classList.contains('hidden')) {
            content.classList.remove('hidden');
            if (icon) {
                icon.style.transform = 'rotate(180deg)';
            }
        }
    });
}
// --- SCORECARD AND LEDGER LOGIC ---

function calculateScores(predictions) {
    const scores = {
        user: 0,
        captain: 0,
        kraken: 0,
        bookie: 0,
        totalCompleted: 0,
        userHits: 0,
        captainHits: 0,
    };

    if (!predictions || !Array.isArray(predictions)) {
        return scores;
    }

    predictions.forEach((p) => {
        try {
            if (!p.result || !p.fixture) return;

            scores.totalCompleted++;
            const { finalOutcome, homeScore, awayScore } = p.result;
            const { fixture } = p;

            let userBasePoints = 0;
            let captainBasePoints = 0;

            if (p.userGuess && typeof p.userGuess.home === 'number' && typeof p.userGuess.away === 'number') {
                const userOutcome = (p.userGuess.home > p.userGuess.away) ? 'H' : ((p.userGuess.home < p.userGuess.away) ? 'A' : 'D');
                if (userOutcome === finalOutcome) {
                    scores.userHits++;
                }
                if (p.userGuess.home === homeScore && p.userGuess.away === awayScore) {
                    userBasePoints = 3;
                } else if (userOutcome === finalOutcome) {
                    userBasePoints = 1;
                }
            }

            if (p.captainReview && p.captainReview.finalVerdict && p.captainReview.predictedScoreline) {
                const verdict = p.captainReview.finalVerdict;
                const captainOutcome = verdict.includes('Draw') ? 'D' : (verdict.startsWith(fixture.HomeTeam) ? 'H' : 'A');
                if (captainOutcome === finalOutcome) {
                    scores.captainHits++;
                }

                const scoreMatch = p.captainReview.predictedScoreline.match(/(\d+)\s*-\s*(\d+)/);
                if (scoreMatch) {
                    const predictedHome = parseInt(scoreMatch[1], 10);
                    const predictedAway = parseInt(scoreMatch[2], 10);
                    if (predictedHome === homeScore && predictedAway === awayScore) {
                        captainBasePoints = 3;
                    } else if (captainOutcome === finalOutcome) {
                        captainBasePoints = 1;
                    }
                } else if (captainOutcome === finalOutcome) {
                    captainBasePoints = 1;
                }
            }

            const odds = [
                parseFloat(fixture.HomeWinOdds || 'NaN'),
                parseFloat(fixture.DrawOdds || 'NaN'),
                parseFloat(fixture.AwayWinOdds || 'NaN'),
            ].filter((o) => !isNaN(o));

            let userBonus = 0;
            let captainBonus = 0;
            const difficulty = getDifficultyRating(fixture);
            const multiplier = getDifficultyMultiplier(difficulty.label);

            if (odds.length > 0) {
                const minOdd = Math.min(...odds);
                const marketFavoriteOutcome = ['H', 'D', 'A'][odds.indexOf(minOdd)];

                if (userBasePoints > 0) {
                    const userOutcome = (p.userGuess.home > p.userGuess.away) ? 'H' : ((p.userGuess.home < p.userGuess.away) ? 'A' : 'D');
                    if (userOutcome !== marketFavoriteOutcome) {
                        userBonus = 2;
                    }
                }
                if (captainBasePoints > 0) {
                    const verdict = p.captainReview.finalVerdict;
                    const captainOutcome = verdict.includes('Draw') ? 'D' : (verdict.startsWith(fixture.HomeTeam) ? 'H' : 'A');
                    if (captainOutcome !== marketFavoriteOutcome) {
                        captainBonus = 2;
                    }
                }
            }

            scores.user += (userBasePoints * multiplier) + userBonus;
            scores.captain += (captainBasePoints * multiplier) + captainBonus;

            if (p.krakenAnalysis && p.krakenAnalysis.ensProbs) {
                const krakenProbs = p.krakenAnalysis.ensProbs;
                const maxIndex = krakenProbs.indexOf(Math.max(...krakenProbs));
                if (['H', 'D', 'A'][maxIndex] === finalOutcome) scores.kraken++;
            }
            if (odds.length > 0) {
                const minOdd = Math.min(...odds);
                if (['H', 'D', 'A'][odds.indexOf(minOdd)] === finalOutcome) scores.bookie++;
            }
        } catch (error) {
            console.error('Error calculating scores for prediction:', p.id, error);
        }
    });

    scores.user = Math.round(scores.user * 10) / 10;
    scores.captain = Math.round(scores.captain * 10) / 10;

    return scores;
}

export function renderLedger(predictions) {
    const ledgerContainer = safeGetElement('ledger-container');
    if (!ledgerContainer) return;

    if (predictions.length === 0) {
        ledgerContainer.innerHTML = '<p class="text-center text-gray-700">No predictions have been unlocked yet.</p>';
        const chartContainer = safeGetElement('chart-container');
        if (chartContainer) chartContainer.classList.add('hidden');
        return;
    }

    const scores = calculateScores(predictions);
    const scorecardHtml = `
        <div class="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            <div class="p-2 bg-gray-200 rounded-md">
                <p class="font-bold text-gray-800">Your Hits 👤</p>
                <p class="font-pirata text-3xl text-gray-900">${scores.userHits}/${scores.totalCompleted} <span class="text-lg">(${scores.user}pts)</span></p>
            </div>
            <div class="p-2 bg-gray-200 rounded-md">
                <p class="font-bold text-gray-800">Captain's Hits ⚔️</p>
                <p class="font-pirata text-3xl text-gray-900">${scores.captainHits}/${scores.totalCompleted} <span class="text-lg">(${scores.captain}pts)</span></p>
            </div>
            <div class="p-2 bg-gray-200 rounded-md">
                <p class="font-bold text-gray-800">Kraken's Hits 🐙</p>
                <p class="font-pirata text-3xl text-gray-900">${scores.kraken}/${scores.totalCompleted}</p>
            </div>
            <div class="p-2 bg-gray-200 rounded-md">
                <p class="font-bold text-gray-800">Bookie's Hits 💰</p>
                <p class="font-pirata text-3xl text-gray-900">${scores.bookie}/${scores.totalCompleted}</p>
            </div>
        </div>
    `;

    const sortedPredictions = [...predictions].sort((a, b) => new Date(b.fixture.MatchDate) - new Date(a.fixture.MatchDate));
    const tableRows = sortedPredictions.map(p => {
        const { fixture, result, captainReview, userGuess, krakenAnalysis } = p;
        const difficulty = getDifficultyRating(fixture);
        const formattedDate = new Date(fixture.MatchDate).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        const actualScore = result ? `${result.homeScore} - ${result.awayScore}` : 'Pending';
        const captainScore = captainReview ? (captainReview.predictedScoreline || 'N/A').match(/\d+\s*-\s*\d+/)?.[0] : 'N/A';
        const userScore = userGuess ? `${userGuess.home} - ${userGuess.away}` : 'N/A';
        let correctIcons = '';
        if (result) {
            const finalOutcome = result.finalOutcome;
            if (userGuess) {
                const userOutcome = userGuess.home > userGuess.away ? 'H' : (userGuess.away > userGuess.home ? 'A' : 'D');
                if (userOutcome === finalOutcome) correctIcons += '<span title="You were right!">👤</span> ';
            }
            if (captainReview && captainReview.finalVerdict) {
                const verdict = captainReview.finalVerdict;
                const captainOutcome = verdict.includes('Draw') ? 'D' : (verdict.startsWith(fixture.HomeTeam) ? 'H' : 'A');
                if (captainOutcome === finalOutcome) correctIcons += '<span title="The Captain was right!">⚔️</span> ';
            }
            if (krakenAnalysis && krakenAnalysis.ensProbs) {
                const krakenProbs = krakenAnalysis.ensProbs;
                const maxIndex = krakenProbs.indexOf(Math.max(...krakenProbs));
                const krakenOutcome = ['H', 'D', 'A'][maxIndex];
                if (krakenOutcome === finalOutcome) correctIcons += '<span title="The Kraken was right!">🐙</span> ';
            }
            const odds = [parseFloat(fixture.HomeWinOdds), parseFloat(fixture.DrawOdds), parseFloat(fixture.AwayWinOdds)];
            const validOdds = odds.filter(o => !isNaN(o));
            if (validOdds.length > 0) {
                const minOdd = Math.min(...validOdds);
                const bookieOutcome = ['H', 'D', 'A'][odds.indexOf(minOdd)];
                if (bookieOutcome === finalOutcome) correctIcons += '<span title="The Bookie was right!">💰</span>';
            }
        }
        let rowClass = 'bg-gray-50';
        if (result) {
            const correctOutcome = result.finalOutcome === 'H' ? 'Home' : result.finalOutcome === 'A' ? 'Away' : 'Draw';
            if (captainReview && captainReview.finalVerdict && captainReview.finalVerdict.includes(correctOutcome)) {
                rowClass = 'bg-green-100';
            } else if (captainReview) {
                rowClass = 'bg-red-100';
            }
        }
        return `<tr class="${rowClass}">
            <td class="py-2 px-3 border-b text-gray-800">
                <p>${fixture.HomeTeam} vs ${fixture.AwayTeam}</p>
                <p class="text-xs text-gray-500">${formattedDate}</p>
                ${correctIcons ? `<p class="text-lg mt-1">${correctIcons}</p>` : ''}
            </td>
            <td class="py-2 px-3 border-b text-center align-middle">
                <div>
                    <span class="text-xs font-bold px-2 py-1 rounded-md ${difficulty.color} ${difficulty.textColor}">${difficulty.label}</span>
                    <p class="text-xs text-gray-500 font-mono mt-1">${fixture.HomeWinOdds}/${fixture.DrawOdds}/${fixture.AwayWinOdds}</p>
                </div>
            </td>
            <td class="py-2 px-3 border-b text-center font-bold text-gray-800 align-middle">${actualScore}</td>
            <td class="py-2 px-3 border-b text-center text-gray-800 align-middle">${captainScore}</td>
            <td class="py-2 px-3 border-b text-center text-gray-800 align-middle">${userScore}</td>
            <td class="py-2 px-3 border-b text-center align-middle">
                <button data-prediction-id="${p.id}" class="view-analysis-btn bg-amber-800 hover:bg-amber-900 text-white text-xs font-bold py-1 px-2 rounded">View</button>
            </td>
        </tr>`;
    }).join('');

    const tableHtml = `
        <div class="overflow-x-auto">
            <table class="min-w-full bg-white rounded-lg shadow">
                <thead class="bg-gray-800 text-white">
                    <tr>
                        <th class="py-2 px-3 text-left">Fixture</th>
                        <th class="py-2 px-3">Difficulty / Odds</th>
                        <th class="py-2 px-3">Result</th>
                        <th class="py-2 px-3">Captain</th>
                        <th class="py-2 px-3">You</th>
                        <th class="py-2 px-3">Analysis</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
        </div>
    `;

    ledgerContainer.innerHTML = scorecardHtml + tableHtml;
    renderSuccessChart(scores);
}

// --- MODAL LOGIC & EVENT LISTENERS ---

export function showAnalysisModal(predictionId) {
    const modal = safeGetElement('analysis-modal');
    const content = safeGetElement('analysis-modal-content');
    if (!modal || !content) return;

    const prediction = unlockedPredictions.find((p) => p.id == predictionId);

    if (!prediction) {
        content.innerHTML = `<p>Could not find analysis for this prediction.</p>`;
    } else {
        try {
            content.innerHTML = getUnlockedPredictionCardHtml(prediction, 'modal-');

            const contentDiv = safeGetElement(`modal-toggle-content-${prediction.fixture.id}`);
            if (contentDiv) {
                contentDiv.classList.remove('hidden');
            }

            if (prediction.krakenAnalysis && prediction.krakenAnalysis.reasoningStats) {
                displayStatisticalReasoning(
                    prediction.fixture.id,
                    prediction.krakenAnalysis.officialHomeTeam,
                    prediction.krakenAnalysis.officialAwayTeam,
                    prediction.krakenAnalysis.reasoningStats,
                    'modal-',
                );
            }
        } catch (error) {
            console.error('Error rendering analysis modal:', error);
            content.innerHTML = '<p class="text-red-500">Error loading analysis.</p>';
        }
    }

    modal.classList.remove('hidden');
}

function toggleFixtureDetails(toggleId) {
    if (!toggleId) return;

    const content = safeGetElement(`toggle-content-${toggleId}`);
    const icon = safeGetElement(`toggle-icon-${toggleId}`);

    if (!content) return;

    content.classList.toggle('hidden');

    if (icon) {
        icon.style.transform = content.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)';
    }
}

export function initializeToggleListeners() {
    document.addEventListener('click', (e) => {
        try {
            const toggleDetailsElement = e.target.closest('.toggle-details');
            if (toggleDetailsElement && toggleDetailsElement.dataset.toggleId) {
                const isNestedToggle = e.target.closest('.kraken-details-toggle, .stats-details-toggle, .qm-details-toggle, .captain-details-toggle');
                if (!isNestedToggle) {
                    e.preventDefault();
                    toggleFixtureDetails(toggleDetailsElement.dataset.toggleId);
                    return;
                }
            }

            const nestedToggle = e.target.closest('.kraken-details-toggle, .stats-details-toggle, .qm-details-toggle, .captain-details-toggle');
            if (nestedToggle && nestedToggle.dataset.target) {
                e.preventDefault();
                const targetId = nestedToggle.getAttribute('data-target');
                const targetElement = safeGetElement(targetId);
                if (targetElement) {
                    const isHidden = targetElement.classList.toggle('hidden');
                    const currentText = nestedToggle.textContent || '';
                    if (isHidden) {
                        nestedToggle.textContent = currentText.replace('↑', '↓').replace('Hide', 'Show');
                    } else {
                        nestedToggle.textContent = currentText.replace('↓', '↑').replace('Show', 'Hide');
                    }
                }
            }
        } catch (error) {
            console.error('Error in toggle listener:', error);
        }
    });
}

let successChart = null;

function renderSuccessChart(scores) {
    const chartContainer = document.getElementById('chart-container');
    const ctx = document.getElementById('success-rate-chart');

    if (!ctx || !scores || scores.totalCompleted === 0) {
        if (chartContainer) chartContainer.classList.add('hidden');
        return;
    }

    chartContainer.classList.remove('hidden');

    const data = {
        labels: ['Your Hits', "Captain's Hits", "Kraken's Hits", "Bookie's Hits"],
        datasets: [{
            label: 'Correct Outcomes',
            data: [scores.userHits, scores.captainHits, scores.kraken, scores.bookie],
            backgroundColor: [
                'rgba(217, 119, 6, 0.8)',
                'rgba(22, 163, 74, 0.8)',
                'rgba(37, 99, 235, 0.8)',
                'rgba(107, 114, 128, 0.8)'
            ],
            borderColor: [
                'rgba(180, 83, 9, 1)',
                'rgba(21, 128, 61, 1)',
                'rgba(29, 78, 216, 1)',
                'rgba(75, 85, 99, 1)'
            ],
            borderWidth: 2
        }]
    };

    if (successChart) {
        successChart.destroy();
    }

    successChart = new Chart(ctx, {
        type: 'doughnut',
        data: data,
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'top',
                },
                title: {
                    display: true,
                    text: `Based on ${scores.totalCompleted} Completed Matches`
                }
            }
        },
    });
}
