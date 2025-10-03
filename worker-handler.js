// worker-handler.js (Updated with new engineered features)

import { setEloRange } from './ui.js';

let trainingWorker;
let workerUrl;
let isTraining = false;
let modelsTrained = false;

export function getTrainingStatus() { return { isTraining, modelsTrained }; }

export function cleanupWorker() {
    if (trainingWorker) {
        trainingWorker.terminate();
        trainingWorker = null;
    }
    if (workerUrl) {
        URL.revokeObjectURL(workerUrl);
        workerUrl = null;
    }
}

export function initWorker() {
    cleanupWorker();
    const workerCode = `
        importScripts('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest/dist/tf.min.js');
        const FORM_MATCHES_COUNT = 5;
        const H2H_MATCHES_COUNT = 5;
        let nnModel, lrModel;
        let teamMap, teamHistories, eloRatings, teamStrengths;
        let trainedFeatureSelection = { form: true, h2h: true, elo: true, offense: true, defense: true, congestion: true };

        const TEAM_NAME_ALIASES = new Map([
            ['Wolverhampton Wanderers', 'Wolves'], ['Man Utd', 'Man United'], ['Manchester United', 'Man United'],
            ['Tottenham Hotspur', 'Tottenham'], ['West Bromwich Albion', 'West Brom'], ['Nottingham Forest', "Nott'm Forest"],
            ['Sheffield Wednesday', 'Sheff Wed'], ['Queens Park Rangers', 'QPR'], ['Brighton & Hove Albion', 'Brighton'],
        ]);

        function getSeasonCode(date) {
            const year = date.getUTCFullYear();
            const month = date.getUTCMonth();
            const seasonEndYear = (month >= 7) ? year + 1 : year;
            const seasonStartYear = seasonEndYear - 1;
            return (seasonStartYear % 100).toString().padStart(2, '0') + (seasonEndYear % 100).toString().padStart(2, '0');
        }

        function calculateTeamStrengths(matches) {
            const teams = [...new Set(matches.flatMap(m => [m.HomeTeam, m.AwayTeam]))].filter(Boolean);
            const strengths = new Map(teams.map(team => [team, { homeAttack: 0, homeDefence: 0, awayAttack: 0, awayDefence: 0, homeGames: 0, awayGames: 0 }]));
            let totalHomeGoals = 0, totalAwayGoals = 0, gameCount = 0;
            matches.forEach(match => {
                const homeGoals = parseInt(match.FTHG, 10), awayGoals = parseInt(match.FTAG, 10);
                if (isNaN(homeGoals) || isNaN(awayGoals) || !strengths.has(match.HomeTeam) || !strengths.has(match.AwayTeam)) return;
                strengths.get(match.HomeTeam).homeAttack += homeGoals;
                strengths.get(match.HomeTeam).homeDefence += awayGoals;
                strengths.get(match.HomeTeam).homeGames++;
                strengths.get(match.AwayTeam).awayAttack += awayGoals;
                strengths.get(match.AwayTeam).awayDefence += homeGoals;
                strengths.get(match.AwayTeam).awayGames++;
                totalHomeGoals += homeGoals; totalAwayGoals += awayGoals; gameCount++;
            });
            const avgHomeGoals = totalHomeGoals / gameCount || 1;
            const avgAwayGoals = totalAwayGoals / gameCount || 1;
            for (const [team, stats] of strengths.entries()) {
                if (stats.homeGames > 0) {
                    stats.homeAttack = (stats.homeAttack / stats.homeGames) / avgHomeGoals;
                    stats.homeDefence = (stats.homeDefence / stats.homeGames) / avgAwayGoals;
                }
                if (stats.awayGames > 0) {
                    stats.awayAttack = (stats.awayAttack / stats.awayGames) / avgAwayGoals;
                    stats.awayDefence = (stats.awayDefence / stats.awayGames) / avgHomeGoals;
                }
            }
            return { strengths, avgHomeGoals, avgAwayGoals };
        }

        function poissonProbability(k, lambda) {
            if (lambda <= 0 || isNaN(lambda)) return 0;
            const factorial = (n) => (n <= 1) ? 1 : n * factorial(n - 1);
            return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
        }

        function getPoissonProbs(homeTeam, awayTeam, strengths, avgHomeGoals, avgAwayGoals) {
            const homeStr = strengths.get(homeTeam), awayStr = strengths.get(awayTeam);
            if (!homeStr || !awayStr) return [0.33, 0.34, 0.33];
            const lambdaHome = homeStr.homeAttack * awayStr.awayDefence * avgHomeGoals;
            const lambdaAway = awayStr.awayAttack * homeStr.homeDefence * avgAwayGoals;
            let homeWin = 0, draw = 0, awayWin = 0;
            for (let i = 0; i <= 5; i++) {
                for (let j = 0; j <= 5; j++) {
                    const prob = poissonProbability(i, lambdaHome) * poissonProbability(j, lambdaAway);
                    if (i > j) homeWin += prob; else if (i < j) awayWin += prob; else draw += prob;
                }
            }
            const total = homeWin + draw + awayWin;
            return total === 0 ? [0.33, 0.34, 0.33] : [homeWin/total, draw/total, awayWin/total];
        }

        function calculateEloRatings(matches) {
            const K = 32, ratings = new Map();
            const teams = [...new Set(matches.flatMap(m => [m.HomeTeam, m.AwayTeam]))].filter(Boolean);
            teams.forEach(team => ratings.set(team, 1500));
            matches.forEach(match => {
                if (!ratings.has(match.HomeTeam) || !ratings.has(match.AwayTeam)) return;
                const R1 = ratings.get(match.HomeTeam), R2 = ratings.get(match.AwayTeam);
                const E1 = 1 / (1 + 10 ** ((R2 - R1) / 400));
                const S1 = match.FTR === 'H' ? 1 : (match.FTR === 'D' ? 0.5 : 0);
                ratings.set(match.HomeTeam, R1 + K * (S1 - E1));
                ratings.set(match.AwayTeam, R2 + K * ((1 - S1) - (1-E1)));
            });
            const ratingValues = Array.from(ratings.values());
            return { ratings, minElo: Math.min(...ratingValues), maxElo: Math.max(...ratingValues) };
        }

        class StatusCallback extends tf.Callback {
            constructor(messagePrefix) { super(); this.messagePrefix = messagePrefix; }
            onEpochEnd(epoch, logs) { self.postMessage({ type: 'status_update', payload: \`\${this.messagePrefix} \${epoch + 1}/50\` }); }
        }

        self.onmessage = async (e) => {
            const { type, payload } = e.data;
            if (type === 'train_model') {
                try {
                    const { matches, params } = payload;
                    const recencyWeighting = params?.recencyWeighting ?? 0.5;
                    const dataRange = params?.dataRange ?? 6;
                    trainedFeatureSelection = params?.features ?? { form: true, h2h: true, elo: true, offense: true, defense: true, congestion: true };
                    
                    self.postMessage({ type: 'status_update', payload: 'Filtering data by season...' });
                    let allMatchesWithDates = matches.map(m => ({ ...m, dateObj: parseDate(m.Date) })).filter(m => m.dateObj);
                    allMatchesWithDates.sort((a,b) => b.dateObj - a.dateObj);

                    if (dataRange < 6) {
                        const allSeasons = [...new Set(allMatchesWithDates.map(m => getSeasonCode(m.dateObj)))];
                        const seasonsToKeep = new Set(allSeasons.slice(0, dataRange));
                        allMatchesWithDates = allMatchesWithDates.filter(m => seasonsToKeep.has(getSeasonCode(m.dateObj)));
                    }
                    
                    self.postMessage({ type: 'status_update', payload: \`Training with \${allMatchesWithDates.length} matches...\` });
                    const { ratings, minElo, maxElo } = calculateEloRatings(allMatchesWithDates.slice().reverse());
                    eloRatings = ratings;
                    const { strengths, avgHomeGoals, avgAwayGoals } = calculateTeamStrengths(allMatchesWithDates);
                    teamStrengths = { strengths, avgHomeGoals, avgAwayGoals };
                    
                    const { features, labels, histories, currentTeamMap } = prepareData(allMatchesWithDates, eloRatings, recencyWeighting);
                    if (!features || features.shape[0] === 0) throw new Error("No valid training data could be generated.");
                    
                    teamMap = currentTeamMap; teamHistories = histories;
                    const inputShape = features.shape[1];
                    nnModel = createNnModel(inputShape); lrModel = createLrModel(inputShape);
                    
                    await nnModel.fit(features, labels, { epochs: 50, batchSize: 32, validationSplit: 0.1, verbose: 0, callbacks: [ tf.callbacks.earlyStopping({ monitor: 'val_loss', patience: 5 }), new StatusCallback('Kraken devouring data...') ] });
                    await lrModel.fit(features, labels, { epochs: 50, batchSize: 32, validationSplit: 0.1, verbose: 0, callbacks: [ new StatusCallback('Kraken mulling it over...') ] });

                    self.postMessage({ type: 'model_trained', payload: { minElo, maxElo } });
                    tf.dispose([features, labels]);

                } catch(error) { self.postMessage({ type: 'training_error', payload: error.message + " " + error.stack }); }
            
            } else if (type === 'predict') {
                const { fixture, settings } = payload;
                try {
                    const officialHomeTeam = findBestTeamNameMatch(fixture.HomeTeam, teamMap);
                    const officialAwayTeam = findBestTeamNameMatch(fixture.AwayTeam, teamMap);
                    if (!teamMap.has(officialHomeTeam) || !teamMap.has(officialAwayTeam)) { throw new Error("Crew member not found in ship's log: '" + (!teamMap.has(officialHomeTeam) ? fixture.HomeTeam : fixture.AwayTeam) + "'."); }
                    
                    const { featureVector, reasoningStats } = createFeaturesForFixture(fixture, teamMap, teamHistories, eloRatings);
                    
                    const { nnProbs, lrProbs, poissonProbs, ensProbs } = tf.tidy(() => {
                        const fixtureFeatures = tf.tensor2d([featureVector]);
                        const nnLogits = nnModel.predict(fixtureFeatures);
                        const lrLogits = lrModel.predict(fixtureFeatures);
                        
                        const temperature = settings?.temperature ?? 1.5;
                        const nnWeight = (settings?.nnWeight ?? 40) / 100;
                        const lrWeight = (settings?.lrWeight ?? 25) / 100;
                        const poissonWeight = (settings?.poissonWeight ?? 35) / 100;

                        const nnProbsTensor = tf.softmax(tf.div(nnLogits, tf.scalar(temperature)));
                        const lrProbsTensor = tf.softmax(tf.div(lrLogits, tf.scalar(temperature)));
                        const poissonProbsArray = getPoissonProbs(officialHomeTeam, officialAwayTeam, teamStrengths.strengths, teamStrengths.avgHomeGoals, teamStrengths.avgAwayGoals);
                        const poissonProbsTensor = tf.tensor(poissonProbsArray).reshape([1,3]);
                        
                        const averagedProbs = tf.addN([
                            nnProbsTensor.mul(tf.scalar(nnWeight)),
                            lrProbsTensor.mul(tf.scalar(lrWeight)),
                            poissonProbsTensor.mul(tf.scalar(poissonWeight))
                        ]);

                        return { nnProbs: nnProbsTensor.dataSync(), lrProbs: lrProbsTensor.dataSync(), poissonProbs: poissonProbsArray, ensProbs: averagedProbs.dataSync() };
                    });

                    const settingsUsed = {
                        temperature: settings?.temperature ?? 1.5,
                        nnWeight: settings?.nnWeight ?? 40,
                        lrWeight: settings?.lrWeight ?? 25,
                        poissonWeight: settings?.poissonWeight ?? 35
                    };

                    e.ports[0].postMessage({ type: 'prediction_result', payload: { nnProbs, lrProbs, poissonProbs, ensProbs, reasoningStats, officialHomeTeam, officialAwayTeam, settingsUsed } });
                } catch (error) { e.ports[0].postMessage({ type: 'prediction_error', payload: error.message }); }
            }
        };

        function findBestTeamNameMatch(name, teamMap) {
            if (teamMap.has(name)) return name;
            if (TEAM_NAME_ALIASES.has(name)) { const alias = TEAM_NAME_ALIASES.get(name); if (teamMap.has(alias)) return alias; }
            const lowerName = name.toLowerCase();
            for (const officialName of teamMap.keys()) { if (officialName.toLowerCase().includes(lowerName)) return officialName; }
            return name;
        }

        function parseDate(dateStr) {
            if (!dateStr || dateStr.length < 8) return null;
            const parts = dateStr.includes('-') ? dateStr.split('-') : dateStr.split('/');
            if (parts.length !== 3) return null;
            let year = parseInt(parts[2], 10);
            if (year < 100) year += 2000;
            const month = parseInt(parts[dateStr.includes('-') ? 1 : 1], 10) - 1;
            const day = parseInt(parts[dateStr.includes('-') ? 2 : 0], 10);
            if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
            return new Date(Date.UTC(year, month, day));
        }

        function calculateH2HStats(homeTeam, awayTeam, allMatchesUpToThisPoint) {
            const h2hMatches = allMatchesUpToThisPoint.filter(m => (m.HomeTeam === homeTeam && m.AwayTeam === awayTeam) || (m.HomeTeam === awayTeam && m.AwayTeam === homeTeam)).slice(-H2H_MATCHES_COUNT);
            let homeTeamWins = 0, awayTeamWins = 0, draws = 0;
            h2hMatches.forEach(m => { if (m.FTR === 'D') draws++; else if ((m.FTR === 'H' && m.HomeTeam === homeTeam) || (m.FTR === 'A' && m.AwayTeam === homeTeam)) homeTeamWins++; else awayTeamWins++; });
            const alpha = 1, totalMatches = h2hMatches.length, smoothedTotal = totalMatches + (alpha * 3);
            return { homeTeamWins, draws, awayTeamWins, totalMatches, featureHomeWin: (homeTeamWins + alpha) / smoothedTotal, featureDraw: (draws + alpha) / smoothedTotal, featureAwayWin: (awayTeamWins + alpha) / smoothedTotal };
        }
        
        // This function is now expanded to calculate all the new metrics
        function calculateTeamStats(teamName, pastMatches, recencyWeighting, venue = 'Overall') {
            let relevantMatches = pastMatches;
            if (venue === 'Home') relevantMatches = pastMatches.filter(m => m.HomeTeam === teamName);
            else if (venue === 'Away') relevantMatches = pastMatches.filter(m => m.AwayTeam === teamName);

            const lastNMatches = relevantMatches.slice(-FORM_MATCHES_COUNT);
            if (lastNMatches.length === 0) return { gamesPlayed: 0 };
            
            const weights = Array.from({length: lastNMatches.length}, (_, i) => (1.0 - recencyWeighting) + (2.0 * recencyWeighting * (i / (lastNMatches.length - 1 || 1))));
            const totalWeight = weights.reduce((sum, w) => sum + w, 0);
            
            let stats = { formPoints: 0, goalsScored: 0, goalsConceded: 0, shots: 0, shotsOnTarget: 0, shotsAgainst: 0, shotsOnTargetAgainst: 0 };

            lastNMatches.forEach((match, i) => {
                const w = weights[i];
                const [FTHG, FTAG, HS, AS, HST, AST] = [match.FTHG, match.FTAG, match.HS, match.AS, match.HST, match.AST].map(val => parseInt(val, 10));

                if (match.HomeTeam === teamName) {
                    if (!isNaN(FTHG)) {
                       if (match.FTR === 'H') stats.formPoints += 3 * w; else if (match.FTR === 'D') stats.formPoints += 1 * w;
                       stats.goalsScored += FTHG * w;
                       stats.goalsConceded += FTAG * w;
                       stats.shots += HS * w;
                       stats.shotsOnTarget += HST * w;
                       stats.shotsAgainst += AS * w;
                       stats.shotsOnTargetAgainst += AST * w;
                    }
                } else { // Away Team
                    if (!isNaN(FTAG)) {
                       if (match.FTR === 'A') stats.formPoints += 3 * w; else if (match.FTR === 'D') stats.formPoints += 1 * w;
                       stats.goalsScored += FTAG * w;
                       stats.goalsConceded += FTHG * w;
                       stats.shots += AS * w;
                       stats.shotsOnTarget += AST * w;
                       stats.shotsAgainst += HS * w;
                       stats.shotsOnTargetAgainst += HST * w;
                    }
                }
            });
            
            if (totalWeight === 0) return { gamesPlayed: relevantMatches.length };

            const avgGoalsScored = stats.goalsScored / totalWeight;
            const avgShots = stats.shots / totalWeight;
            const avgShotsOnTarget = stats.shotsOnTarget / totalWeight;
            
            return {
                gamesPlayed: relevantMatches.length,
                formPoints: (stats.formPoints / (totalWeight * 3)),
                avgGoalsScored,
                avgGoalsConceded: stats.goalsConceded / totalWeight,
                avgShots,
                avgShotsOnTarget,
                avgShotsAgainst: stats.shotsAgainst / totalWeight,
                avgShotsOnTargetAgainst: stats.shotsOnTargetAgainst / totalWeight,
                shootingAccuracy: avgShots > 0 ? avgShotsOnTarget / avgShots : 0,
                conversionRate: avgShotsOnTarget > 0 ? avgGoalsScored / avgShotsOnTarget : 0,
            };
        }

        // Expanded feature vector to include all the new data points
        function getFeatureVector(match, teamMap, homeStats, awayStats, h2hStats, homeElo, awayElo, homeDaysSince, awayDaysSince) {
        const numTeams = teamMap.size;
        const homeTeamVec = Array(numTeams).fill(0); homeTeamVec[teamMap.get(match.HomeTeam)] = 1;
        const awayTeamVec = Array(numTeams).fill(0); awayTeamVec[teamMap.get(match.AwayTeam)] = 1;

        return [
            ...homeTeamVec, ...awayTeamVec,
            // Elo
            trainedFeatureSelection.elo ? (homeElo / 2000) : 0,
            trainedFeatureSelection.elo ? (awayElo / 2000) : 0,
            // Form Stats
            trainedFeatureSelection.form ? (homeStats.formPoints || 0) : 0,
            trainedFeatureSelection.form ? (awayStats.formPoints || 0) : 0,
            trainedFeatureSelection.form ? (homeStats.avgGoalsScored || 0) : 0,
            trainedFeatureSelection.form ? (awayStats.avgGoalsScored || 0) : 0,
            trainedFeatureSelection.form ? (homeStats.avgGoalsConceded || 0) : 0,
            trainedFeatureSelection.form ? (awayStats.avgGoalsConceded || 0) : 0,
            // H2H Stats
            trainedFeatureSelection.h2h ? (h2hStats.featureHomeWin || 0) : 0,
            trainedFeatureSelection.h2h ? (h2hStats.featureDraw || 0) : 0,
            trainedFeatureSelection.h2h ? (h2hStats.featureAwayWin || 0) : 0,
            // Offensive Efficiency
            trainedFeatureSelection.offense ? (homeStats.shootingAccuracy || 0) : 0,
            trainedFeatureSelection.offense ? (awayStats.shootingAccuracy || 0) : 0,
            trainedFeatureSelection.offense ? (homeStats.conversionRate || 0) : 0,
            trainedFeatureSelection.offense ? (awayStats.conversionRate || 0) : 0,
            // Defensive Solidity
            trainedFeatureSelection.defense ? (homeStats.avgShotsAgainst || 0) : 0,
            trainedFeatureSelection.defense ? (awayStats.avgShotsAgainst || 0) : 0,
            // Fixture Congestion
            trainedFeatureSelection.congestion ? (Math.min(homeDaysSince, 21) / 21) : 0,
            trainedFeatureSelection.congestion ? (Math.min(awayDaysSince, 21) / 21) : 0,
        ];
    }

        function prepareData(matches, eloRatings, recencyWeighting) {
            matches.sort((a, b) => a.dateObj - b.dateObj);
            const teams = [...new Set(matches.flatMap(m => [m.HomeTeam, m.AwayTeam]))].filter(Boolean);
            const currentTeamMap = new Map(teams.map((team, i) => [team, i]));
            const histories = new Map(teams.map(team => [team, []]));
            matches.forEach(m => {
                if (histories.has(m.HomeTeam)) histories.get(m.HomeTeam).push(m);
                if (histories.has(m.AwayTeam)) histories.get(m.AwayTeam).push(m);
            });

            const featureData = [], labelData = [];
            for (let i = 0; i < matches.length; i++) {
                const match = matches[i];
                if (!match.HomeTeam || !match.AwayTeam || !match.FTR || !currentTeamMap.has(match.HomeTeam) || !currentTeamMap.has(match.AwayTeam)) continue;
                
                const homeElo = eloRatings.get(match.HomeTeam) || 1500;
                const awayElo = eloRatings.get(match.AwayTeam) || 1500;
                const homeTeamHistory = histories.get(match.HomeTeam).filter(m => m.dateObj < match.dateObj);
                const awayTeamHistory = histories.get(match.AwayTeam).filter(m => m.dateObj < match.dateObj);

                if (homeTeamHistory.length < FORM_MATCHES_COUNT || awayTeamHistory.length < FORM_MATCHES_COUNT) continue;

                const homeStats = calculateTeamStats(match.HomeTeam, homeTeamHistory, recencyWeighting, 'Home');
                const awayStats = calculateTeamStats(match.AwayTeam, awayTeamHistory, recencyWeighting, 'Away');
                
                const homeLastMatch = homeTeamHistory[homeTeamHistory.length - 1];
                const homeDaysSince = homeLastMatch ? (match.dateObj - homeLastMatch.dateObj) / (1000 * 3600 * 24) : 14;
                const awayLastMatch = awayTeamHistory[awayTeamHistory.length - 1];
                const awayDaysSince = awayLastMatch ? (match.dateObj - awayLastMatch.dateObj) / (1000 * 3600 * 24) : 14;

                const h2hStats = calculateH2HStats(match.HomeTeam, match.AwayTeam, matches.slice(0, i));
                featureData.push(getFeatureVector(match, currentTeamMap, homeStats, awayStats, h2hStats, homeElo, awayElo, homeDaysSince, awayDaysSince));
                
                if (match.FTR === 'H') labelData.push([1, 0, 0]);
                else if (match.FTR === 'D') labelData.push([0, 1, 0]);
                else labelData.push([0, 0, 1]);
            }
            return { features: tf.tensor2d(featureData), labels: tf.tensor2d(labelData), histories, currentTeamMap };
        }

        // Updated to calculate all new features for a single upcoming match
        function createFeaturesForFixture(fixture, teamMap, histories, eloRatings) {
            const recency = 0.5;
            const homeElo = eloRatings.get(fixture.HomeTeam) || 1500;
            const awayElo = eloRatings.get(fixture.AwayTeam) || 1500;
            const allMatches = [...new Set([...histories.values()].flat())].sort((a,b) => a.dateObj - b.dateObj);
            const homeHistory = histories.get(fixture.HomeTeam) || [];
            const awayHistory = histories.get(fixture.AwayTeam) || [];

            const homeStats = calculateTeamStats(fixture.HomeTeam, homeHistory, recency, 'Home');
            const awayStats = calculateTeamStats(fixture.AwayTeam, awayHistory, recency, 'Away');
            const homeOverall = calculateTeamStats(fixture.HomeTeam, homeHistory, recency, 'Overall');
            const awayOverall = calculateTeamStats(fixture.AwayTeam, awayHistory, recency, 'Overall');
            
            const fixtureDate = parseDate(fixture.MatchDate);
            const homeLastMatch = homeHistory.length > 0 ? homeHistory[homeHistory.length - 1] : null;
            const homeDaysSince = homeLastMatch && fixtureDate ? (fixtureDate - homeLastMatch.dateObj) / (1000 * 3600 * 24) : 14;
            const awayLastMatch = awayHistory.length > 0 ? awayHistory[awayHistory.length - 1] : null;
            const awayDaysSince = awayLastMatch && fixtureDate ? (fixtureDate - awayLastMatch.dateObj) / (1000 * 3600 * 24) : 14;

            const h2hStats = calculateH2HStats(fixture.HomeTeam, fixture.AwayTeam, allMatches);
            const reasoningStats = { homeStats, awayStats, h2hStats, homeOverallStats: homeOverall, awayOverallStats: awayOverall, homeElo, awayElo, homeDaysSince, awayDaysSince };
            const featureVector = getFeatureVector(fixture, teamMap, homeStats, awayStats, h2hStats, homeElo, awayElo, homeDaysSince, awayDaysSince);
            return { featureVector, reasoningStats };
        }

        function createNnModel(inputShape) {
            const model = tf.sequential();
            model.add(tf.layers.dense({ inputShape: [inputShape], units: 128, activation: 'relu', kernelRegularizer: tf.regularizers.l2({l2: 0.0001}) }));
            model.add(tf.layers.dropout({ rate: 0.5 }));
            model.add(tf.layers.dense({ units: 64, activation: 'relu', kernelRegularizer: tf.regularizers.l2({l2: 0.0001}) }));
            model.add(tf.layers.dropout({ rate: 0.5 }));
            model.add(tf.layers.dense({ units: 3, activation: 'softmax' }));
            model.compile({ optimizer: tf.train.adam(0.0001), loss: 'categoricalCrossentropy' });
            return model;
        }

        function createLrModel(inputShape) {
            const model = tf.sequential();
            model.add(tf.layers.dense({ inputShape: [inputShape], units: 3, activation: 'softmax' }));
            model.compile({ optimizer: tf.train.adam(0.0001), loss: 'categoricalCrossentropy' });
            return model;
        }
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    workerUrl = URL.createObjectURL(blob);
    trainingWorker = new Worker(workerUrl);

    const trainingStatusArea = document.getElementById('training-status-area');
    const trainModelsBtn = document.getElementById('train-models-btn');

    trainingWorker.onmessage = (e) => {
        const { type, payload } = e.data;
        if (type === 'model_trained') {
            isTraining = false;
            modelsTrained = true;
            if (payload) setEloRange(payload.minElo, payload.maxElo);
            trainingStatusArea.innerHTML = '<span class="text-green-600 font-semibold">The Kraken is ready!</span>';
            // Hide the initial 'Awaken' button and show the 'Re-train' button
            const retrainBtn = document.getElementById('retrain-kraken-btn');
            if (trainModelsBtn) trainModelsBtn.classList.add('hidden');
            if (retrainBtn) retrainBtn.classList.remove('hidden');
        } else if (type === 'status_update') {
            trainingStatusArea.innerHTML = `<div class="flex items-center justify-center"><dotlottie-wc src="https://lottie.host/19109b73-f99a-4a89-a48c-d5b90bf22b22/tlVX1kmiPt.lottie" background="transparent" speed="1" style="width: 40px; height: 40px;" loop autoplay></dotlottie-wc><p class="ml-2">${payload}</p></div>`;
        } else if (type === 'training_error') {
            isTraining = false;
            trainingStatusArea.innerHTML = `<span class="text-red-500">Training failed, Captain! ${payload}</span>`;
            trainModelsBtn.disabled = false;
            trainModelsBtn.classList.remove('svg-button-disabled');
        }
    };
}

export function trainModels(historicalMatches, trainingParams = {}) {
    if (isTraining) return;
    isTraining = true;
    modelsTrained = false;

    const trainBtn = document.getElementById('train-models-btn');
    if (trainBtn) {
        trainBtn.disabled = true;
        trainBtn.classList.add('svg-button-disabled');
    }

    if (!historicalMatches || historicalMatches.length < 50) {
        document.getElementById('training-status-area').innerHTML = '<span class="text-red-500">Not enough grog (data) to train!</span>';
        isTraining = false;
        if (trainBtn) {
            trainBtn.disabled = false;
            trainBtn.classList.remove('svg-button-disabled');
        }
        return;
    }

    trainingWorker.postMessage({ type: 'train_model', payload: { matches: historicalMatches, params: trainingParams } });
}

const openCardIfNeeded = (index) => {
    const content = document.getElementById(`toggle-content-${index}`);
    const icon = document.getElementById(`toggle-icon-${index}`);
    if (content?.classList.contains('hidden')) {
        content.classList.remove('hidden');
        if(icon) icon.style.transform = 'rotate(180deg)';
    }
};

// The function signature is updated to accept the full fixture object
export async function runPrediction(fixture, index, predictionId, customSettings = null) {
    openCardIfNeeded(index);
    const predictionEl = document.getElementById(`prediction-${index}`);
    predictionEl.innerHTML = `<div class="flex items-center justify-center text-gray-600"><dotlottie-wc src="https://lottie.host/19109b73-f99a-4a89-a48c-d5b90bf22b22/tlVX1kmiPt.lottie" background="transparent" speed="1" style="width: 40px; height: 40px;" loop autoplay></dotlottie-wc><p class="ml-2">The Kraken is stirring...</p></div>`;

    if (!modelsTrained) {
        predictionEl.innerHTML = '<span class="text-orange-500">Ye must awaken the Kraken first!</span>';
        return;
    }

    const result = await new Promise(resolve => {
        const channel = new MessageChannel();
        trainingWorker.postMessage({
            type: 'predict',
            payload: { fixture: fixture, settings: customSettings }
        }, [channel.port2]);
        channel.port1.onmessage = e => resolve(e.data);
    });

    if (result.type === 'prediction_error') {
        predictionEl.innerHTML = `<span class="text-red-500 text-xs">${result.payload}</span>`;
        return;
    }

    const { nnProbs, lrProbs, poissonProbs, ensProbs, reasoningStats, officialHomeTeam, officialAwayTeam, settingsUsed } = result.payload;

    const krakenDataForFirestore = {
        nnProbs: Array.from(nnProbs),
        lrProbs: Array.from(lrProbs),
        poissonProbs: Array.from(poissonProbs),
        ensProbs: Array.from(ensProbs),
        reasoningStats,
        officialHomeTeam,
        officialAwayTeam,
        settingsUsed,
        timestamp: new Date()
    };

    try {
        const predictionDocRef = doc(db, "users", auth.currentUser.uid, "unlocked_predictions", predictionId);
        await updateDoc(predictionDocRef, { krakenAnalysis: krakenDataForFirestore });
    } catch (error) {
        console.error("Failed to save Kraken analysis to Firestore:", error);
        predictionEl.innerHTML = `<p class="text-red-500 text-xs mt-2">Warning: Could not save result to your logbook.</p>`;
    }
}
