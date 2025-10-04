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

/**
 * Makes a call to Gemini API
 */
async function callGemini(promptText, apiKey) {
    if (!apiKey) {
        throw new Error('API key is required. Please set your Gemini API key in settings.');
    }

    const requestBody = {
        contents: [{
            parts: [{
                text: promptText
            }]
        }],
        generationConfig: {
            maxOutputTokens: 8192,
            temperature: 0.7,
        }
    };

    try {
        const response = await fetch(`${GEMINI_API_ENDPOINT}?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('Gemini API Error:', errorData);
            throw new Error(`API call failed: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        
        if (!data.candidates || !data.candidates[0]) {
            throw new Error('No response from Gemini');
        }

        const candidate = data.candidates[0];
        
        if (candidate.finishReason && candidate.finishReason !== 'STOP') {
            console.warn(`Response finished with reason: ${candidate.finishReason}`);
        }

        return candidate.content.parts[0].text;
    } catch (error) {
        console.error('Gemini API call failed:', error);
        throw error;
    }
}

/**
 * Finds upcoming fixtures for a league
 */
export async function findFixtures(leagueName, apiKey, testMode = false) {
    const leagueNameMapping = {
        "English Premier League": "Premier League",
        "Spanish La Liga": "La Liga",
        "German Bundesliga": "Bundesliga",
        "Italian Serie A": "Serie A",
        "French Ligue 1": "Ligue 1",
        "Dutch Eredivisie": "Eredivisie",
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
        const sevenDaysFromNow = new Date();
        sevenDaysFromNow.setDate(today.getDate() + 7);
        startDate = today.toISOString().split('T')[0];
        endDate = sevenDaysFromNow.toISOString().split('T')[0];
    }

    const prompt = `
You are a sports data expert specializing in finding football match schedules.
Your task is to find all upcoming league matches for '${searchLeagueName}'.

**CRITICAL DATE RULES:**
- Today is ${today.toISOString().split('T')[0]}.
- ${testMode ? `TEST MODE: Find all matches that happened between ${startDate} and ${endDate}.` : `Find all matches scheduled from today (${startDate}) up to and including ${endDate}.`}
- Do not include matches that have already started today unless in test mode.

**SEARCH INSTRUCTIONS:**
- To find the fixtures, use your knowledge of recent football schedules for: "${searchLeagueName} fixtures this week".
- Check reliable sources like BBC Sport, Sky Sports, or the official league website.

**CRITICAL OUTPUT FORMAT:**
- You MUST return ONLY a single, valid JSON array of objects.
- Do NOT include any explanatory text, markdown, or anything else outside of the JSON array.
- Each object in the array MUST have these exact three keys: "HomeTeam", "AwayTeam", and "MatchDate".
- The "MatchDate" MUST be in "YYYY-MM-DD" format.
- If your search finds no fixtures, you MUST return an empty JSON array: [].

**Example of a valid response:**
[
  {
    "HomeTeam": "Arsenal",
    "AwayTeam": "Chelsea",
    "MatchDate": "${startDate}"
  }
]
`;

    try {
        const responseText = await callGemini(prompt, apiKey); 
        console.log('Raw Gemini Response:', responseText);

        let cleanedResponse = responseText.replace(/```json|```/g, '').trim();
        const jsonStartIndex = cleanedResponse.indexOf('[');
        const jsonEndIndex = cleanedResponse.lastIndexOf(']');

        if (jsonStartIndex === -1 || jsonEndIndex === -1) {
            throw new Error('No valid JSON array found in response');
        }

        cleanedResponse = cleanedResponse.substring(jsonStartIndex, jsonEndIndex + 1);
        const rawFixtures = JSON.parse(cleanedResponse);

        if (!Array.isArray(rawFixtures)) {
            throw new Error('Response is not an array');
        }

        const validEndDate = new Date(endDate);
        validEndDate.setHours(23, 59, 59, 999);

        const standardizedFixtures = rawFixtures
            .map((fixture, index) => {
                const requiredFields = ['HomeTeam', 'AwayTeam', 'MatchDate'];
                const missingFields = requiredFields.filter(field => !fixture[field]);

                if (missingFields.length > 0) {
                    console.warn(`Fixture ${index} missing fields:`, missingFields);
                    return null;
                }

                const matchDate = new Date(fixture.MatchDate);
                if (matchDate > validEndDate) {
                    console.warn(`Fixture beyond window:`, fixture);
                    return null;
                }

                if (fixture.HomeTeam === 'Not specified' || fixture.AwayTeam === 'Not specified') {
                    console.warn('Invalid team name:', fixture);
                    return null;
                }

                return {
                    ...fixture,
                    HomeTeam: standardizeTeamName(fixture.HomeTeam),
                    AwayTeam: standardizeTeamName(fixture.AwayTeam)
                };
            })
            .filter(f => f !== null);

        console.log(`Validated ${standardizedFixtures.length} fixtures.`);
        return standardizedFixtures;
    } catch (error) {
        console.error('Error finding fixtures:', error);
        throw new Error(`The spyglass is cracked! ${error.message}`);
    }
}

/**
 * Gets odds for a list of fixtures
 */
export async function getOddsForFixtures(fixtures, apiKey) {
    const fixtureListString = fixtures
        .map(f => `- ${f.HomeTeam} vs ${f.AwayTeam} on ${f.MatchDate}`)
        .join('\n');

    const prompt = `
You are a sports betting data expert.
Your task is to find the pre-match betting odds for the following list of football matches.

**Matches:**
${fixtureListString}

**Instructions:**
1. For each match in the list, use your internal knowledge of betting odds to find the best available DECIMAL odds for Home Win, Draw, and Away Win.
2. If you cannot find odds for a specific match, use "N/A" for all three odd values.

**CRITICAL OUTPUT FORMAT:**
- You MUST return ONLY a single, valid JSON array of objects.
- Each object in the array MUST have these exact five keys: "HomeTeam", "AwayTeam", "MatchDate", "HomeWinOdds", "DrawOdds", "AwayWinOdds".
- The "MatchDate" MUST be in "YYYY-MM-DD" format.
- The team names in your response MUST EXACTLY match the team names from the input list.
- Do NOT include any explanatory text or markdown.

**Example of a valid response:**
[
  {
    "HomeTeam": "Arsenal",
    "AwayTeam": "Chelsea",
    "MatchDate": "2025-09-28",
    "HomeWinOdds": "2.10",
    "DrawOdds": "3.40",
    "AwayWinOdds": "3.50"
  }
]
`;

    try {
        const responseText = await callGemini(prompt, apiKey);
        let cleanedResponse = responseText.replace(/```json|```/g, '').trim();
        const jsonStartIndex = cleanedResponse.indexOf('[');
        const jsonEndIndex = cleanedResponse.lastIndexOf(']');

        if (jsonStartIndex === -1 || jsonEndIndex === -1) {
            console.warn('No valid JSON array found in odds response, returning empty array.', cleanedResponse);
            return []; // Return empty array if no valid JSON
        }

        cleanedResponse = cleanedResponse.substring(jsonStartIndex, jsonEndIndex + 1);
        const oddsArray = JSON.parse(cleanedResponse);
        
        if (!Array.isArray(oddsArray)) {
            throw new Error('Parsed odds response is not an array');
        }
        
        return oddsArray;
    } catch (error) {
        console.error('Error getting odds:', error);
        throw new Error(`The bookmakers are hiding their odds! ${error.message}`);
    }
}

/**
 * Gets Quartermaster's tactical briefing
 */
export async function getQuartermasterReport(homeTeam, awayTeam, apiKey) {
    const prompt = `**Persona:** You are a ship's Quartermaster, a meticulous and fact-focused intelligence officer.

**Task:** Search for and report the MOST CURRENT information for: ${homeTeam} vs ${awayTeam}.

**WHAT TO SEARCH FOR:**
1. Current league position and points for both teams
2. Recent results (last 5 matches) for both teams
3. Current injuries and suspensions
4. Recent team news and any tactical changes
5. Head-to-head recent history

**CRITICAL INSTRUCTIONS:**
- Be specific and factual. Use real, verified data only.
- Today's date for reference: ${new Date().toISOString().split('T')[0]}
- Focus on the current 2025-2026 season data.

**OUTPUT STRUCTURE:**
Your entire response MUST be a single JSON object with ONE key: "tacticalBriefing".
The value must be a single string with 3-4 sections.
Each section format: **Header**::Content\\n

Example: "**Current Form**::${homeTeam} has won 3 of last 5, sitting 5th in the table.\\n**Injuries**::Key midfielder out for 2 weeks."`;

    try {
        const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent';
        
        const requestBody = {
            contents: [{
                parts: [{ text: prompt }]
            }],
            tools: [{
                googleSearch: {}
            }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 8192
            }
        };

        const response = await fetch(`${endpoint}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('Quartermaster API Error:', errorData);
            throw new Error(`API call failed: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        
        if (!data.candidates || !data.candidates[0]) {
            throw new Error('No response from API');
        }
        
        const responseText = data.candidates[0].content.parts[0].text;
        console.log('Quartermaster Raw Response:', responseText);

        const cleanedResponse = responseText.replace(/```json|```/g, '').trim();
        const briefingRegex = /"tacticalBriefing"\s*:\s*"(.*)"/s;
        const match = cleanedResponse.match(briefingRegex);

        if (!match || !match[1]) {
            throw new Error('Could not extract tacticalBriefing content from response');
        }

        const rawContent = match[1];
        const escapedContent = rawContent.replace(/"/g, '\\"');
        const validJsonString = `{ "tacticalBriefing": "${escapedContent}" }`;
        const parsedResponse = JSON.parse(validJsonString);

        if (!parsedResponse.tacticalBriefing) {
            parsedResponse.tacticalBriefing = "**Intel Report**::Intelligence gathering is ongoing, Captain...";
        }

        return parsedResponse;
    } catch (error) {
        console.error('Error getting Quartermaster report:', error);
        throw new Error(`The Quartermaster's report got scrambled! ${error.message}`);
    }
}

/**
 * Gets Captain's final review
 */
export async function getCaptainReview(homeTeam, awayTeam, statsString, quartermasterIntel, bookmakerOdds, apiKey, recentLessons = []) {
    const krakenMatch = statsString.match(/Home Win: (\d+)%, Draw: (\d+)%, Away Win: (\d+)%/);
    const krakenHome = krakenMatch ? parseInt(krakenMatch[1]) / 100 : 0.33;
    const krakenDraw = krakenMatch ? parseInt(krakenMatch[2]) / 100 : 0.33;
    const krakenAway = krakenMatch ? parseInt(krakenMatch[3]) / 100 : 0.33;

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
- The "synthesis" value must be a single string.
- Create 2-3 distinct, headed paragraphs within this string.
- Each paragraph MUST start with a short, pirate-themed, bolded header (e.g., **The Kraken's Numbers**), followed by '::', followed by content.
- Each section MUST be separated by '\\n'.

**REQUIRED FORMAT EXAMPLE:**
"**The Numbers Say...**::The Kraken be whisperin' that the home crew has the edge, statistically speakin'.\\n**But Me Gut Says...**::The Quartermaster's report of a key injury gives me pause."

**CRITICAL FORMATTING:**
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
}`;

    try {
        const responseText = await callGemini(prompt, apiKey);
        console.log('Captain Raw Response:', responseText);

        const jsonStart = responseText.indexOf('{');
        const jsonEnd = responseText.lastIndexOf('}');

        if (jsonStart === -1 || jsonEnd === -1) {
            throw new Error('No valid JSON object found in Captain response');
        }

        const jsonString = responseText.substring(jsonStart, jsonEnd + 1);
        const parsedResponse = JSON.parse(jsonString);

        // Normalize probabilities
        if (!parsedResponse.finalProbabilities || typeof parsedResponse.finalProbabilities !== 'object') {
            parsedResponse.finalProbabilities = {home: krakenHome, draw: krakenDraw, away: krakenAway};
        }
        
        const {home, draw, away} = parsedResponse.finalProbabilities;
        const total = (home || 0) + (draw || 0) + (away || 0);
        if (Math.abs(total - 1.0) > 0.01) {
            parsedResponse.finalProbabilities = {
                home: (home || 0) / total,
                draw: (draw || 0) / total,
                away: (away || 0) / total
            };
        }

        // Ensure verdict matches highest probability
        const {home: finalHome, draw: finalDraw, away: finalAway} = parsedResponse.finalProbabilities;
        const highestProb = Math.max(finalHome || 0, finalDraw || 0, finalAway || 0);
        let correctVerdict;
        if ((finalHome || 0) === highestProb) {
            correctVerdict = `${homeTeam} Victory`;
        } else if ((finalDraw || 0) === highestProb) {
            correctVerdict = 'Draw';
        } else {
            correctVerdict = `${awayTeam} Victory`;
        }
        
        if (parsedResponse.finalVerdict !== correctVerdict) {
            console.log(`Fixing verdict to match probabilities: ${correctVerdict}`);
            parsedResponse.finalVerdict = correctVerdict;
        }

        // Ensure scoreline matches verdict
        if (!parsedResponse.predictedScoreline) {
            parsedResponse.predictedScoreline = `${homeTeam} 1 - 1 ${awayTeam}`;
        }

        const scoreMatch = parsedResponse.predictedScoreline.match(/(\d+)\s*-\s*(\d+)/);
        if (scoreMatch) {
            const homeScore = parseInt(scoreMatch[1]);
            const awayScore = parseInt(scoreMatch[2]);
            let scoreOutcome;
            if (homeScore > awayScore) scoreOutcome = `${homeTeam} Victory`;
            else if (homeScore === awayScore) scoreOutcome = 'Draw';
            else scoreOutcome = `${awayTeam} Victory`;

            if (scoreOutcome !== parsedResponse.finalVerdict) {
                console.log('Fixing score to match verdict');
                if (parsedResponse.finalVerdict === `${homeTeam} Victory`) {
                    parsedResponse.predictedScoreline = `${homeTeam} 2 - 1 ${awayTeam}`;
                } else if (parsedResponse.finalVerdict === 'Draw') {
                    parsedResponse.predictedScoreline = `${homeTeam} 1 - 1 ${awayTeam}`;
                } else {
                    parsedResponse.predictedScoreline = `${homeTeam} 1 - 2 ${awayTeam}`;
                }
            }
        }

        if (!parsedResponse.synthesis) {
            parsedResponse.synthesis = "**Musings**::The winds be unclear, but the Kraken's wisdom guides us.";
        }
        
        if (!parsedResponse.confidence) {
            parsedResponse.confidence = 'Choppy Waters';
        }

        return parsedResponse;
    } catch (error) {
        console.error('Error getting Captain review:', error);
        throw new Error(`The Captain's orders got jumbled! ${error.message}`);
    }
}
