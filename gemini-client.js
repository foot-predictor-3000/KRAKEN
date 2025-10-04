// gemini-client.js (Full Corrected Version)

const GEMINI_API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

/**
 * Standardizes team names to match historical data format
 */
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
        "Norwich City": "Norwich",
        "Coventry City": "Coventry",
        "Bayern Munich": "Bayern Munich",
        "Ein Frankfurt": "Eintracht Frankfurt",
        "FC Union Berlin": "Union Berlin",
        "Hamburger SV": "Hamburg",
        "SC Freiburg": "Freiburg",
        "TSG Hoffenheim": "Hoffenheim",
        "FC Koln": "FC Cologne",
        "Ath Madrid": "Atletico Madrid",
        "Ath Bilbao": "Athletic Bilbao",
        "Real Sociedad": "Sociedad",
        "Inter": "Inter Milan",
    };

    if (aliases[teamName]) return aliases[teamName];
    
    const standardValues = new Set(Object.values(aliases));
    if (standardValues.has(teamName)) return teamName;
    
    return teamName;
}

// gemini-client.js -> REPLACE THIS FUNCTION
async function callGemini(promptText, apiKey) {
    if (!apiKey) {
        throw new Error('API key is required. Please set your Gemini API key in settings.');
    }
    const GEMINI_API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

    const requestBody = {
        contents: [{
            parts: [{
                text: promptText
            }]
        }],
        generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: 8192,
            temperature: 0.7,
        }
    };

    try {
        const response = await fetch(`${GEMINI_API_ENDPOINT}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('Gemini API Error:', errorData);
            throw new Error(`API call failed: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        if (!data.candidates || !data.candidates[0]) {
            if (data.promptFeedback && data.promptFeedback.blockReason) {
                 throw new Error(`Request was blocked by the API for safety reasons: ${data.promptFeedback.blockReason}`);
            }
            throw new Error('No response candidate found from Gemini.');
        }

        const candidate = data.candidates[0];
        if (candidate.finishReason && candidate.finishReason !== 'STOP') {
            console.warn(`Response finished with reason: ${candidate.finishReason}.`);
             if (candidate.finishReason === 'SAFETY') {
                 throw new Error('Gemini blocked the response due to safety settings.');
             }
        }
        return candidate.content.parts[0].text;
    } catch (error) {
        console.error('Gemini API call failed:', error);
        throw error;
    }
}
// gemini-client.js -> REPLACE THIS FUNCTION
export async function findFixtures(leagueName, apiKey, testMode = false) {
    const leagueNameMapping = {
        "English Premier League": "Premier League", "English Championship": "Championship",
        "English League 1": "League One", "English League 2": "League Two",
        "Spanish La Liga": "La Liga", "German Bundesliga": "Bundesliga",
        "Italian Serie A": "Serie A", "French Ligue 1": "Ligue 1", "Dutch Eredivisie": "Eredivisie",
    };
    const searchLeagueName = leagueNameMapping[leagueName] || leagueName;
    const today = new Date();
    let startDate, endDate;

    if (testMode) {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(today.getDate() - 7);
        startDate = sevenDaysAgo.toISOString().split('T')[0];
        endDate = today.toISOString().split('T')[0];
    } else {
        startDate = today.toISOString().split('T')[0];
        const sevenDaysFromNow = new Date();
        sevenDaysFromNow.setDate(today.getDate() + 7);
        endDate = sevenDaysFromNow.toISOString().split('T')[0];
    }

    const prompt = `
    You are a highly accurate football fixture data expert. Your primary goal is factual correctness.
    Today's date is ${new Date().toISOString().split('T')[0]}.

    **TASK:**
    Find all official league matches for '${searchLeagueName}'.
    - ${testMode ? `Find matches that happened between ${startDate} and ${endDate}.` : `Find matches scheduled from today (${startDate}) up to and including ${endDate}.`}

    **CRITICAL ACCURACY RULES:**
    1.  **DO NOT INVENT FIXTURES.** Your knowledge should be based on official schedules.
    2.  **HANDLE INTERNATIONAL BREAKS:** If there are no league matches in the specified date range because of events like an international break, it is ESSENTIAL that you return an empty array.
    3.  **VERIFY DATES:** Ensure every match returned falls strictly within the ${startDate} to ${endDate} window.

    **CRITICAL OUTPUT FORMAT:**
    - Your entire response MUST be ONLY a single, valid JSON array of objects.
    - Each object MUST have these exact three keys: "HomeTeam", "AwayTeam", and "MatchDate".
    - "MatchDate" MUST be in "YYYY-MM-DD" format.
    - If no fixtures are found, you MUST return an empty JSON array: [].

    **Example of a valid response if matches are found:**
    [
      { "HomeTeam": "Arsenal", "AwayTeam": "Chelsea", "MatchDate": "${startDate}" }
    ]

    **Example of a valid response if NO matches are found:**
    []
    `;

    try {
        // NOTE: We are calling the new robust callGemini function from our previous fix.
        // We will also use the model name you discovered works best.
        const model = 'gemini-2.5-flash-latest'; // Using the model you confirmed works.
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        
        const requestBody = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.0, // Set temperature to 0.0 for maximum factuality
                maxOutputTokens: 8192,
            }
        };

        const response = await fetch(`${endpoint}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API call failed: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        const responseJsonString = data.candidates[0].content.parts[0].text;
        const rawFixtures = JSON.parse(responseJsonString);

        if (!Array.isArray(rawFixtures)) {
            throw new Error("Response was not a JSON array");
        }
        return rawFixtures;
    } catch (error) {
        console.error('Error finding fixtures:', error);
        throw new Error(`The spyglass returned garbled data! ${error.message}`);
    }
}


// gemini-client.js -> REPLACE THIS FUNCTION
export async function getQuartermasterReport(homeTeam, awayTeam, krakenStats, apiKey) {
    const statsReport = `
    - Match: ${homeTeam} (Home) vs ${awayTeam} (Away)
    - Home Team Elo Rating: ${Math.round(krakenStats.homeElo)} (Grade: ${krakenStats.homeEloGrade})
    - Away Team Elo Rating: ${Math.round(krakenStats.awayElo)} (Grade: ${krakenStats.awayEloGrade})
    - Home Team Form (last 5 at home): ${Math.round(krakenStats.homeStats.formPoints * 15)}/15 points
    - Away Team Form (last 5 away): ${Math.round(krakenStats.awayStats.formPoints * 15)}/15 points
    - Home Team Attack (avg goals scored at home): ${krakenStats.homeStats.avgGoalsScored.toFixed(2)}
    - Away Team Attack (avg goals scored away): ${krakenStats.awayStats.avgGoalsScored.toFixed(2)}
    - Home Team Defence (avg goals conceded at home): ${krakenStats.homeStats.avgGoalsConceded.toFixed(2)}
    - Away Team Defence (avg goals conceded away): ${krakenStats.awayStats.avgGoalsConceded.toFixed(2)}
    - Head-to-Head (last 5): ${krakenStats.h2hStats.homeTeamWins} ${homeTeam} wins, ${krakenStats.h2hStats.draws} draws, ${krakenStats.h2hStats.awayTeamWins} ${awayTeam} wins.
    `;

    const prompt = `
    **Persona:** You are a ship's Quartermaster, a meticulous and fact-focused football analyst. Your primary directive is to turn cold, hard data into a tactical narrative. You do NOT need to search for new information.
    **Task:** Write a single, cohesive **Tactical Briefing** for the upcoming match: ${homeTeam} vs ${awayTeam}, based **ONLY** on the statistical report provided below.
    **Statistical Report:**
    ${statsReport}
    **CRITICAL INSTRUCTIONS:**
    1.  **SYNTHESIZE, DO NOT SEARCH:** Your entire report must be based on the numbers in the "Statistical Report". Do not invent or search for external information like injuries or news.
    2.  **INTERPRET THE DATA:** Explain what the numbers mean. For example, if a team has high Elo but poor form, point that out. If one team has a strong attack but a weak defense, highlight that tactical dynamic.
    3.  **BE FACTUAL:** Ground every statement in the provided data.
    **ABSOLUTELY ESSENTIAL - OUTPUT STRUCTURE:**
    - Your entire response MUST be a single JSON object.
    - This object must have ONE key: "tacticalBriefing".
    - The value of "tacticalBriefing" must be a single string containing 2-4 distinct sections.
    - Each section MUST start with a short, bolded header (e.g., **Team Form**), followed by the separator '::', followed by the paragraph content.
    - Each section (header and content) MUST be separated from the next by the newline character '\\n'.
    **REQUIRED FORMAT EXAMPLE for the 'tacticalBriefing' string value:**
    "**Statistical Standings**::The Elo ratings suggest ${homeTeam} is the stronger crew on paper, but their recent form of only 4 points from 15 is concerning.\\n**Tactical Outlook**::${awayTeam}'s defense appears leaky, conceding over 2 goals per game on their travels. This could be an opportunity for ${homeTeam} if their attack, which averages 1.5 goals, can capitalize."
    `;

    try {
        const responseJsonString = await callGemini(prompt, apiKey);
        const parsedResponse = JSON.parse(responseJsonString);

        if (!parsedResponse.tacticalBriefing) {
            return { tacticalBriefing: "**Intel Report**::Intelligence gathering is ongoing, Captain..." };
        }
        return parsedResponse;
    } catch (error) {
        console.error('Error getting Quartermaster report:', error);
        throw new Error(`The Quartermaster's report got scrambled! ${error.message}`);
    }
}
// gemini-client.js -> REPLACE THIS FUNCTION
export async function getCaptainReview(homeTeam, awayTeam, statsString, quartermasterIntel, bookmakerOdds, apiKey, recentLessons = []) {
    const lessonsSection = recentLessons.length > 0
        ? `4. **Recent Lessons from Your Logbook (You must consider these!):**\n${recentLessons.map(l => `- ${l}`).join('\n')}`
        : '';

    const prompt = `**Persona:** You are Captain Turfbeard, a wise and decisive pirate captain.
    **Task:** Provide your final analysis for: ${homeTeam} (HOME) vs ${awayTeam} (AWAY).
    **Data to Synthesize:**
    1. **The Kraken's Forecast (Cold, Hard Numbers):** ${statsString}
    2. **The Quartermaster's Intel (The Ground Truth):** ${JSON.stringify(quartermasterIntel, null, 2)}
    3. **The Bookmaker's Odds (Market Sentiment):** Home: ${bookmakerOdds.homeWin}, Draw: ${bookmakerOdds.draw}, Away: ${bookmakerOdds.awayWin}.
    ${lessonsSection}
    **CRITICAL INSTRUCTIONS FOR "synthesis":**
    - The value must be a single string containing 2-3 distinct, headed paragraphs.
    - Each paragraph MUST start with a short, pirate-themed, bolded header (e.g., **The Kraken's Numbers**), followed by '::', followed by content.
    - Each section MUST be separated by '\\n'.
    **CRITICAL FORMATTING:**
    - Respond with a single JSON object.
    - This object must have the exact keys: "synthesis", "finalProbabilities", "finalVerdict", "confidence", "predictedScoreline".
    - For "predictedScoreline": Use EXACT format "${homeTeam} X - Y ${awayTeam}".
    - Your predicted score MUST match your finalVerdict.
    **Required JSON Structure:**
    {
      "synthesis": "**The Kraken's Cold Calculation**::The numbers point to a home victory...\\n**The Quartermaster's Tavern Gossip**::But the tactical report suggests a leaky defense...",
      "finalProbabilities": { "home": 0.55, "draw": 0.25, "away": 0.20 },
      "finalVerdict": "MUST be '${homeTeam} Victory', '${awayTeam} Victory', or 'Draw'",
      "confidence": "One of: 'Sure as the Tides', 'Favourable Winds', 'Choppy Waters', 'Against the Wind', 'A Long Shot for the Loot'",
      "predictedScoreline": "${homeTeam} 2 - 1 ${awayTeam}"
    }`;

    try {
        const responseJsonString = await callGemini(prompt, apiKey);
        const parsedResponse = JSON.parse(responseJsonString);

        const { finalProbabilities, finalVerdict, predictedScoreline } = parsedResponse;
        const { home, draw, away } = finalProbabilities || {};

        let correctVerdict;
        const maxProb = Math.max(home || 0, draw || 0, away || 0);
        if (maxProb === (home || 0)) correctVerdict = `${homeTeam} Victory`;
        else if (maxProb === (draw || 0)) correctVerdict = 'Draw';
        else correctVerdict = `${awayTeam} Victory`;

        if (finalVerdict !== correctVerdict) {
            console.warn(`Fixing verdict from "${finalVerdict}" to "${correctVerdict}"`);
            parsedResponse.finalVerdict = correctVerdict;
        }

        const scoreMatch = predictedScoreline ? predictedScoreline.match(/(\d+)\s*-\s*(\d+)/) : null;
        let scoreOutcome;
        if (scoreMatch) {
            const homeScore = parseInt(scoreMatch[1], 10);
            const awayScore = parseInt(scoreMatch[2], 10);
            if (homeScore > awayScore) scoreOutcome = `${homeTeam} Victory`;
            else if (awayScore > homeScore) scoreOutcome = `${awayTeam} Victory`;
            else scoreOutcome = 'Draw';
        }

        if (!scoreMatch || scoreOutcome !== parsedResponse.finalVerdict) {
            console.warn(`Fixing scoreline to match verdict: "${parsedResponse.finalVerdict}"`);
            if (parsedResponse.finalVerdict === `${homeTeam} Victory`) parsedResponse.predictedScoreline = `${homeTeam} 2 - 1 ${awayTeam}`;
            else if (parsedResponse.finalVerdict === `${awayTeam} Victory`) parsedResponse.predictedScoreline = `${homeTeam} 1 - 2 ${awayTeam}`;
            else parsedResponse.predictedScoreline = `${homeTeam} 1 - 1 ${awayTeam}`;
        }

        return parsedResponse;
    } catch (error) {
        console.error('Error getting Captain review:', error);
        throw new Error(`The Captain's orders got jumbled! ${error.message}`);
    }
}
