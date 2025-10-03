// gemini-client.js

let apiKey = '';
const API_HOST = 'https://generativelanguage.googleapis.com';
const API_URL = `${API_HOST}/v1beta/models/gemini-pro:generateContent`;

/**
 * Sets the user-provided Gemini API key.
 * @param {string} key The API key.
 */
export function setApiKey(key) {
    apiKey = key;
}

/**
 * Gets the currently stored API key.
 * @returns {string} The API key.
 */
export function getApiKey() {
    return apiKey;
}

/**
 * Makes a call to the Gemini API with a given prompt.
 * @param {string} promptText The prompt to send to the model.
 * @returns {Promise<string>} The text response from the model.
 */
async function callGemini(promptText) {
    if (!apiKey) {
        throw new Error("Gemini API key not set. Please set it in the settings.");
    }

    try {
        const response = await fetch(`${API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }],
            }),
        });

        if (!response.ok) {
            const errorBody = await response.json();
            console.error('Gemini API Error Response:', errorBody);
            const errorMessage = errorBody.error?.message || `HTTP error! status: ${response.status}`;
            throw new Error(`Gemini API Error: ${errorMessage}`);
        }

        const data = await response.json();
        
        if (!data.candidates || data.candidates.length === 0 || !data.candidates[0].content || !data.candidates[0].content.parts || data.candidates[0].content.parts.length === 0) {
            console.warn("Gemini response is empty or invalidly structured:", data);
            const finishReason = data.candidates?.[0]?.finishReason;
            if (finishReason && finishReason !== 'STOP') {
                 throw new Error(`The request was stopped for safety reasons (${finishReason}). Your prompt may be inappropriate. Please try again with a different query.`);
            }
            return "[]"; 
        }

        return data.candidates[0].content.parts[0].text;

    } catch (error) {
        console.error("Error calling Gemini API:", error);
        throw error; // Re-throw the error to be caught by the calling function
    }
}


/**
 * Standardizes team names to match historical data format.
 * @param {string} teamName The team name to standardize.
 * @returns {string} The standardized name.
 */
function standardizeTeamName(teamName) {
    if (!teamName) return "";
    const aliases = {
        "Wolverhampton Wanderers": "Wolves", "Man Utd": "Man United", "Manchester United": "Man United",
        "Tottenham Hotspur": "Tottenham", "West Bromwich Albion": "West Brom", "Nott'm Forest": "Nottingham Forest",
        "Sheffield Wednesday": "Sheff Wed", "Queens Park Rangers": "QPR", "Brighton & Hove Albion": "Brighton",
    };
    return aliases[teamName] || teamName;
}


/**
 * Finds upcoming fixtures using the Gemini API.
 * @param {string} leagueName The name of the league to search for.
 * @param {boolean} testMode Whether to search for past matches for testing.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of fixture objects.
 */
export async function findFixtures(leagueName, testMode = false) {
    const today = new Date();
    let startDate, endDate;

    if (testMode) {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(today.getDate() - 7);
        startDate = sevenDaysAgo.toISOString().split('T')[0];
        endDate = today.toISOString().split('T')[0];
    } else {
        const sevenDaysFromNow = new Date();
        sevenDaysFromNow.setDate(today.getDate() + 7);
        startDate = today.toISOString().split('T')[0];
        endDate = sevenDaysFromNow.toISOString().split('T')[0];
    }

    const prompt = `
        You are a sports data expert. Find all league matches for '${leagueName}' scheduled from ${startDate} to ${endDate}.
        Today's date is ${today.toISOString().split('T')[0]}.
        Return ONLY a single, valid JSON array of objects. Each object must have "HomeTeam", "AwayTeam", and "MatchDate" (in "YYYY-MM-DD" format).
        If no fixtures are found, return an empty array: [].

        Example of a valid response:
        [
          {
            "HomeTeam": "Arsenal",
            "AwayTeam": "Chelsea",
            "MatchDate": "${startDate}"
          }
        ]
    `;

    try {
        const responseText = await callGemini(prompt);
        let cleanedResponse = responseText.replace(/```json|```/g, "").trim();
        const jsonStartIndex = cleanedResponse.indexOf('[');
        const jsonEndIndex = cleanedResponse.lastIndexOf(']');
        if (jsonStartIndex === -1 || jsonEndIndex === -1) {
            throw new Error("No valid JSON array found in Gemini response.");
        }
        cleanedResponse = cleanedResponse.substring(jsonStartIndex, jsonEndIndex + 1);
        const rawFixtures = JSON.parse(cleanedResponse);

        return rawFixtures.map(fixture => ({
            ...fixture,
            HomeTeam: standardizeTeamName(fixture.HomeTeam),
            AwayTeam: standardizeTeamName(fixture.AwayTeam),
        })).filter(f => f.HomeTeam && f.AwayTeam && f.MatchDate);

    } catch (error) {
        console.error("Error finding fixtures:", error);
        throw new Error("The spyglass is cracked! Could not fetch fixtures.");
    }
}

/**
 * Fetches betting odds for a list of fixtures.
 * @param {Array<object>} fixtures The fixtures to get odds for.
 * @returns {Promise<object>} A map of fixture IDs to their odds.
 */
export async function getOddsForFixtures(fixtures) {
    const fixtureListString = fixtures.map(f => `- ${f.HomeTeam} vs ${f.AwayTeam} on ${f.MatchDate}`).join('\n');

    const prompt = `
        You are a sports betting data expert. Find the best available DECIMAL odds for Home Win, Draw, and Away Win for these matches:
        ${fixtureListString}
        
        Return ONLY a single, valid JSON object. The keys should be a unique identifier for each match (e.g., "ArsenalChelseaYYYY-MM-DD").
        The value for each key should be an object with "HomeWinOdds", "DrawOdds", and "AwayWinOdds". Use "N/A" if odds are not found.

        Example of a valid response:
        {
          "ArsenalChelsea2025-09-28": { "HomeWinOdds": "2.10", "DrawOdds": "3.40", "AwayWinOdds": "3.50" }
        }
    `;

    try {
        const responseText = await callGemini(prompt);
        let cleanedResponse = responseText.replace(/```json|```/g, "").trim();
        const jsonStartIndex = cleanedResponse.indexOf('{');
        const jsonEndIndex = cleanedResponse.lastIndexOf('}');
        if (jsonStartIndex === -1 || jsonEndIndex === -1) {
            throw new Error("No valid JSON object found in odds response.");
        }
        cleanedResponse = cleanedResponse.substring(jsonStartIndex, jsonEndIndex + 1);
        return JSON.parse(cleanedResponse);
    } catch (error) {
        console.error("Error fetching odds:", error);
        throw new Error("The bookmakers are hiding their odds! Could not fetch odds.");
    }
}

/**
 * Generates a tactical briefing for a match.
 * @param {string} homeTeam The home team name.
 * @param {string} awayTeam The away team name.
 * @returns {Promise<object>} The Quartermaster's report object.
 */
export async function getQuartermasterReport(homeTeam, awayTeam) {
    const prompt = `
        **Persona:** You are a ship's Quartermaster, a meticulous and fact-focused intelligence officer for a pirate crew analyzing a football match.
        **Task:** Provide a **Tactical Briefing** for: ${homeTeam} vs ${awayTeam}.
        **Instructions:** Your report must be based on current, verifiable information (recent results, team news, injuries).
        
        **CRITICAL OUTPUT FORMAT:**
        - Your entire response MUST be a single JSON object with ONE key: "tacticalBriefing".
        - The value of "tacticalBriefing" must be a single string.
        - Create 2-4 distinct sections within this string.
        - Each section MUST start with a short, bolded header (e.g., **Team Form**), followed by '::', followed by the content.
        - Each section MUST be separated from the next by the newline character '\\n'.

        **REQUIRED FORMAT EXAMPLE for 'tacticalBriefing' string:**
        "**Recent Form**::Arsenal comes into this match on a winning streak...\\n**Injury Report**::Arsenal's main striker is a doubt..."
    `;

    try {
        const responseText = await callGemini(prompt);
        const cleanedResponse = responseText.replace(/```json|```/g, "").trim();
        const briefingRegex = /"tacticalBriefing"\s*:\s*"(.*)"/s;
        const match = cleanedResponse.match(briefingRegex);
        if (!match || !match[1]) {
            throw new Error("Could not extract tacticalBriefing content from the response.");
        }
        const rawContent = match[1];
        const validJsonString = `{ "tacticalBriefing": "${rawContent.replace(/"/g, '\\"')}" }`;
        return JSON.parse(validJsonString);
    } catch (error) {
        console.error("Error fetching Quartermaster report:", error);
        throw new Error("The Quartermaster's report got scrambled in transmission!");
    }
}

/**
 * Generates the Captain's final review and prediction.
 * @param {string} homeTeam The home team name.
 * @param {string} awayTeam The away team name.
 * @param {string} statsString The string of Kraken's probabilities.
 * @param {object} quartermasterIntel The Quartermaster's report.
 * @param {object} bookmakerOdds The bookmaker's odds.
 * @param {Array<string>} recentLessons Array of recent lessons learned.
 * @returns {Promise<object>} The Captain's review object.
 */
export async function getCaptainReview(homeTeam, awayTeam, statsString, quartermasterIntel, bookmakerOdds, recentLessons) {
    const lessonsString = recentLessons.length > 0 ? `4. **Recent Lessons from Your Logbook:**\n- ${recentLessons.join('\n- ')}` : "";

    const prompt = `
        **Persona:** You are Captain Turfbeard, a wise pirate captain analyzing a football match.
        **Task:** Provide your final analysis for: ${homeTeam} (HOME) vs ${awayTeam} (AWAY).

        **Data to Synthesize:**
        1. **The Kraken's Forecast (Numbers):** ${statsString}
        2. **The Quartermaster's Intel (Ground Truth):** ${JSON.stringify(quartermasterIntel, null, 2)}
        3. **The Bookmaker's Odds (Market Sentiment):** Home: ${bookmakerOdds.homeWin}, Draw: ${bookmakerOdds.draw}, Away: ${bookmakerOdds.awayWin}.
        ${lessonsString}

        **CRITICAL INSTRUCTIONS for "synthesis":**
        - The "synthesis" value must be a single string with 2-3 distinct, headed paragraphs.
        - Each paragraph MUST start with a short, pirate-themed, bolded header (e.g., **The Kraken's Numbers**), followed by '::', then the content.
        - Each section MUST be separated by '\\n'.
        
        **CRITICAL FORMATTING REQUIREMENTS:**
        - Respond with a single JSON object with NO MARKDOWN.
        - For "predictedScoreline": Use EXACT format "${homeTeam} X - Y ${awayTeam}".
        - Your predicted score MUST match your finalVerdict.

        **Required JSON Structure:**
        {
          "synthesis": "**The Kraken's Cold Calculation**::The numbers point to a home victory...\\n**The Quartermaster's Tavern Gossip**::But the news of their lead scorer's injury cannot be ignored...",
          "finalProbabilities": { "home": 0.XX, "draw": 0.XX, "away": 0.XX },
          "finalVerdict": "MUST be '${homeTeam} Victory', '${awayTeam} Victory', or 'Draw'",
          "confidence": "One of: 'Sure as the Tides', 'Favourable Winds', 'Choppy Waters', 'Against the Wind', 'A Long Shot for the Loot'",
          "predictedScoreline": "${homeTeam} X - Y ${awayTeam}"
        }
    `;

    try {
        const responseText = await callGemini(prompt);
        const jsonStart = responseText.indexOf('{');
        const jsonEnd = responseText.lastIndexOf('}');
        if (jsonStart === -1 || jsonEnd === -1) {
            throw new Error("No valid JSON object found in Captain's response");
        }
        const jsonString = responseText.substring(jsonStart, jsonEnd + 1);
        const parsedResponse = JSON.parse(jsonString);

        // Basic validation and cleanup
        if (!parsedResponse.finalProbabilities) {
            parsedResponse.finalProbabilities = { home: 0.34, draw: 0.33, away: 0.33 };
        }
        if (!parsedResponse.finalVerdict) {
            parsedResponse.finalVerdict = "Draw";
        }
        if (!parsedResponse.predictedScoreline) {
             parsedResponse.predictedScoreline = `${homeTeam} 1 - 1 ${awayTeam}`;
        }
        if (!parsedResponse.synthesis) {
            parsedResponse.synthesis = "**Musings**::The winds be unclear, but the Kraken's wisdom guides us.";
        }
        if (!parsedResponse.confidence) {
            parsedResponse.confidence = "Choppy Waters";
        }

        return parsedResponse;

    } catch (error) {
        console.error("Error fetching Captain's review:", error);
        throw new Error("The Captain's orders got jumbled in the wind!");
    }
}

/**
 * Fetches match results from a remote CSV file.
 * @param {string} leagueCode The league code (e.g., 'E0').
 * @param {string} season The season code (e.g., '2425').
 * @returns {Promise<Map<string, object>>} A map of match results.
 */
export async function fetchResultsFromSource(leagueCode, season) {
    const proxy = 'https://corsproxy.io/?';
    const url = `${proxy}${encodeURIComponent(`https://www.football-data.co.uk/mmz4281/${season}/${leagueCode}.csv`)}`;
    const resultsMap = new Map();

    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) {
            throw new Error(`Could not fetch results data. Status: ${response.status}`);
        }
        const csvText = await response.text();
        const lines = csvText.split('\n').filter(line => line.trim() !== '');
        if (lines.length < 2) return resultsMap;

        const headers = lines[0].replace(/^\uFEFF/, '').split(',').map(h => h.trim());
        lines.slice(1).forEach(line => {
            const values = line.split(',');
            const match = {};
            headers.forEach((header, i) => {
                match[header] = values[i] ? values[i].trim() : '';
            });

            const resultDate = parseFootballDataDate(match.Date);
            const homeTeam = standardizeTeamName(match.HomeTeam);
            const awayTeam = standardizeTeamName(match.AwayTeam);

            if (homeTeam && awayTeam && resultDate && match.FTHG && match.FTAG && match.FTR) {
                const lookupKey = `${homeTeam}-${awayTeam}-${resultDate}`;
                resultsMap.set(lookupKey, {
                    homeScore: parseInt(match.FTHG, 10),
                    awayScore: parseInt(match.FTAG, 10),
                    finalOutcome: match.FTR,
                });
            }
        });
        return resultsMap;

    } catch (error) {
        console.error(`Error fetching results for season ${season}:`, error);
        throw error;
    }
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
        console.error("Error parsing date:", dateStr, error);
        return null;
    }
}
