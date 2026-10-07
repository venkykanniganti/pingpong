/**
 * Club Ping Pong ELO Leaderboard Application
 * Integrated with Live Google Spreadsheet:
 * Ratings Sheet (gid=1691595355) & Match Log Sheet (gid=0)
 */

const DEFAULT_SPREADSHEET_ID = "2PACX-1vTlXSqdP61ab-ZPfFTBAgiB-BYZ-Pi9vBiJPfCJMybt7pYu2ZwPArH0hinsekARYgO3bTcuyeLCdbGM";
const RATINGS_GID = "1691595355";
const MATCH_LOG_GID = "0";

// App State
let players = [];
let matches = [];
let currentSpreadsheetId = localStorage.getItem("pingpong_sheet_id") || DEFAULT_SPREADSHEET_ID;

document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

function initApp() {
    setupEventListeners();
    const sheetInput = document.getElementById("sheetUrlInput");
    if (sheetInput) {
        sheetInput.value = getPubHtmlUrl(currentSpreadsheetId);
    }
    loadLiveSpreadsheet(currentSpreadsheetId);
}

function getPubHtmlUrl(sheetId) {
    return `https://docs.google.com/spreadsheets/d/e/${sheetId}/pubhtml`;
}

function getCsvUrl(sheetId, gid) {
    return `https://docs.google.com/spreadsheets/d/e/${sheetId}/pub?single=true&output=csv&gid=${gid}`;
}

function extractSpreadsheetId(inputUrl) {
    if (!inputUrl) return DEFAULT_SPREADSHEET_ID;
    
    // Match /d/e/ID/ or /d/ID/ or raw ID
    const matchE = inputUrl.match(/\/d\/e\/([a-zA-Z0-9-_]+)/);
    if (matchE && matchE[1]) return matchE[1];
    
    const matchStandard = inputUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (matchStandard && matchStandard[1]) return matchStandard[1];

    if (inputUrl.length > 20 && !inputUrl.includes("/")) {
        return inputUrl;
    }
    
    return DEFAULT_SPREADSHEET_ID;
}

function setupEventListeners() {
    // Search input
    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
        searchInput.addEventListener("input", handleSearchAndFilter);
    }

    // Sort select
    const sortSelect = document.getElementById("sortSelect");
    if (sortSelect) {
        sortSelect.addEventListener("change", handleSearchAndFilter);
    }

    // Connect Sheet Form
    const connectForm = document.getElementById("connectForm");
    if (connectForm) {
        connectForm.addEventListener("submit", (e) => {
            e.preventDefault();
            const inputVal = document.getElementById("sheetUrlInput").value.trim();
            const newId = extractSpreadsheetId(inputVal);
            
            currentSpreadsheetId = newId;
            localStorage.setItem("pingpong_sheet_id", currentSpreadsheetId);
            loadLiveSpreadsheet(currentSpreadsheetId);
        });
    }

    // Refresh Button
    const refreshBtn = document.getElementById("refreshBtn");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", () => {
            loadLiveSpreadsheet(currentSpreadsheetId);
        });
    }
}

// Fetch and sync both Ratings & Match Log sheets
async function loadLiveSpreadsheet(sheetId) {
    showStatus("Syncing live Ratings & Match Log from Google Sheets...", "info");

    const ratingsCsvUrl = getCsvUrl(sheetId, RATINGS_GID);
    const matchLogCsvUrl = getCsvUrl(sheetId, MATCH_LOG_GID);

    try {
        const [ratingsRes, matchLogRes] = await Promise.all([
            fetch(ratingsCsvUrl),
            fetch(matchLogCsvUrl)
        ]);

        if (!ratingsRes.ok || !matchLogRes.ok) {
            throw new Error(`Ratings HTTP ${ratingsRes.status} | Match Log HTTP ${matchLogRes.status}`);
        }

        const ratingsCsvText = await ratingsRes.text();
        const matchLogCsvText = await matchLogRes.text();

        const rawMatches = parseMatchLogCsv(matchLogCsvText);
        matches = rawMatches;

        const rawPlayers = parseRatingsCsv(ratingsCsvText);
        
        // Enrich players with wins, losses, and form from match log
        players = enrichPlayersWithStats(rawPlayers, rawMatches);

        updateUI();
        showStatus(`Synced live data! Loaded ${players.length} players & ${matches.length} recorded matches.`, "success");
    } catch (err) {
        console.error("Error syncing Google Sheet:", err);
        showStatus(`Failed to fetch Google Sheet: ${err.message}. Please check sheet publication settings.`, "error");
    }
}

// Parse Ratings Sheet CSV (Rank,P,Rating,show)
function parseRatingsCsv(csvText) {
    const lines = csvText.split(/\r\n|\n/).filter(line => line.trim() !== "");
    if (lines.length < 2) return [];

    const parsed = [];
    for (let i = 1; i < lines.length; i++) {
        const row = parseCsvRow(lines[i]);
        if (row.length < 3) continue;

        const rankVal = parseInt(row[0], 10);
        const nameVal = row[1] ? row[1].trim() : "";
        const ratingVal = parseInt(row[2], 10);

        if (nameVal && !isNaN(ratingVal)) {
            parsed.push({
                rank: isNaN(rankVal) ? parsed.length + 1 : rankVal,
                name: nameVal,
                elo: ratingVal,
                wins: 0,
                losses: 0,
                form: []
            });
        }
    }

    return parsed;
}

// Parse Match Log Sheet CSV
function parseMatchLogCsv(csvText) {
    const lines = csvText.split(/\r\n|\n/).filter(line => line.trim() !== "");
    if (lines.length < 3) return [];

    const matchesList = [];

    // Rows start from line index 2 (row 3 of CSV)
    for (let i = 2; i < lines.length; i++) {
        const row = parseCsvRow(lines[i]);
        if (row.length < 4) continue;

        const date = row[0] ? row[0].trim() : "";
        const p1 = row[1] ? row[1].trim() : "";
        const p2 = row[2] ? row[2].trim() : "";
        const winnerCode = row[3] ? row[3].trim().toUpperCase() : "";

        if (!p1 || !p2 || !winnerCode) continue;

        const isP1Winner = winnerCode === "P1";
        const winnerName = isP1Winner ? p1 : p2;
        const loserName = isP1Winner ? p2 : p1;

        // Scores calculation
        const g1P1 = parseInt(row[4], 10);
        const g1P2 = parseInt(row[5], 10);
        const g2P1 = parseInt(row[6], 10);
        const g2P2 = parseInt(row[7], 10);
        const g3P1 = parseInt(row[8], 10);
        const g3P2 = parseInt(row[9], 10);

        let p1Sets = 0;
        let p2Sets = 0;

        if (!isNaN(g1P1) && !isNaN(g1P2)) {
            if (g1P1 > g1P2) p1Sets++; else if (g1P2 > g1P1) p2Sets++;
        }
        if (!isNaN(g2P1) && !isNaN(g2P2)) {
            if (g2P1 > g2P2) p1Sets++; else if (g2P2 > g2P1) p2Sets++;
        }
        if (!isNaN(g3P1) && !isNaN(g3P2)) {
            if (g3P1 > g3P2) p1Sets++; else if (g3P2 > g3P1) p2Sets++;
        }

        let scoreDisplay = "";
        if (p1Sets > 0 || p2Sets > 0) {
            scoreDisplay = isP1Winner ? `${p1Sets} - ${p2Sets}` : `${p2Sets} - ${p1Sets}`;
        } else {
            scoreDisplay = "2 - 0";
        }

        const isUpset = row[16] ? row[16].trim().toLowerCase() === "yes" : false;
        const ptDiff = row[17] ? parseInt(row[17].trim(), 10) : 0;
        const eloChange = ptDiff > 0 ? `+${ptDiff} / -${ptDiff}` : "";

        matchesList.push({
            id: i,
            date,
            p1,
            p2,
            winner: winnerName,
            loser: loserName,
            score: scoreDisplay,
            isUpset,
            eloChange,
            p1Pre: row[10],
            p2Pre: row[11],
            p1Post: row[12],
            p2Post: row[13]
        });
    }

    return matchesList;
}

// Calculate wins, losses, and recent form per player from match log
function enrichPlayersWithStats(playerList, matchLog) {
    const playerMap = {};

    playerList.forEach(p => {
        playerMap[p.name.toLowerCase()] = {
            ...p,
            wins: 0,
            losses: 0,
            form: [] // stores 'W' or 'L' for recent matches
        };
    });

    // Process matches in chronological order
    matchLog.forEach(match => {
        const winnerKey = match.winner.toLowerCase();
        const loserKey = match.loser.toLowerCase();

        if (playerMap[winnerKey]) {
            playerMap[winnerKey].wins++;
            playerMap[winnerKey].form.push("W");
        } else {
            // Player in match log not in ratings list yet
            playerMap[winnerKey] = {
                rank: 99,
                name: match.winner,
                elo: 1000,
                wins: 1,
                losses: 0,
                form: ["W"]
            };
        }

        if (playerMap[loserKey]) {
            playerMap[loserKey].losses++;
            playerMap[loserKey].form.push("L");
        } else {
            playerMap[loserKey] = {
                rank: 99,
                name: match.loser,
                elo: 1000,
                wins: 0,
                losses: 1,
                form: ["L"]
            };
        }
    });

    // Extract last 5 games for form
    const enrichedList = Object.values(playerMap).map(p => {
        const recentForm = p.form.slice(-5);
        return {
            ...p,
            form: recentForm.length > 0 ? recentForm : ["-"]
        };
    });

    // Sort by official rank or ELO
    enrichedList.sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        return b.elo - a.elo;
    });

    enrichedList.forEach((p, idx) => p.rank = idx + 1);

    return enrichedList;
}

// Standard CSV line parser handling quotes
function parseCsvRow(rowText) {
    const result = [];
    let insideQuotes = false;
    let entry = "";
    
    for (let i = 0; i < rowText.length; i++) {
        const char = rowText[i];
        if (char === '"' || char === "'") {
            insideQuotes = !insideQuotes;
        } else if (char === ',' && !insideQuotes) {
            result.push(entry);
            entry = "";
        } else {
            entry += char;
        }
    }
    result.push(entry);
    return result;
}

// UI Rendering Functions
function updateUI() {
    renderStatsSummary();
    renderLeaderboard(players);
    renderMatchHistory(matches);
}

function renderStatsSummary() {
    const totalPlayersEl = document.getElementById("statTotalPlayers");
    const totalMatchesEl = document.getElementById("statTotalMatches");
    const topPlayerEl = document.getElementById("statTopPlayer");

    if (totalPlayersEl) totalPlayersEl.textContent = players.length;
    if (totalMatchesEl) totalMatchesEl.textContent = matches.length;

    if (topPlayerEl) {
        const top = players.length > 0 ? players[0] : null;
        topPlayerEl.textContent = top ? `${top.name} (${top.elo})` : "N/A";
    }
}

function renderLeaderboard(dataList) {
    const tbody = document.getElementById("leaderboardBody");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (dataList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No players found matching your criteria.</td></tr>`;
        return;
    }

    dataList.forEach(player => {
        const tr = document.createElement("tr");

        // Rank Badge
        let rankBadge = `#${player.rank}`;
        let rankClass = "rank-normal";
        if (player.rank === 1) {
            rankBadge = `🥇 #1`;
            rankClass = "rank-gold";
        } else if (player.rank === 2) {
            rankBadge = `🥈 #2`;
            rankClass = "rank-silver";
        } else if (player.rank === 3) {
            rankBadge = `🥉 #3`;
            rankClass = "rank-bronze";
        }

        // Win Rate %
        const totalGames = player.wins + player.losses;
        const winRate = totalGames > 0 ? Math.round((player.wins / totalGames) * 100) : 0;

        // Form pills
        const formHtml = player.form.map(f => {
            const isWin = f.toUpperCase() === "W";
            if (f === "-") return `<span class="form-pill neutral">-</span>`;
            return `<span class="form-pill ${isWin ? 'win' : 'loss'}">${f.toUpperCase()}</span>`;
        }).join("");

        tr.innerHTML = `
            <td><span class="rank-badge ${rankClass}">${rankBadge}</span></td>
            <td class="player-name">${escapeHtml(player.name)}</td>
            <td class="elo-score"><strong>${player.elo}</strong></td>
            <td>${player.wins}W - ${player.losses}L</td>
            <td>
                <div class="winrate-container">
                    <span class="winrate-text">${winRate}%</span>
                    <div class="winrate-bar"><div class="winrate-fill" style="width: ${winRate}%"></div></div>
                </div>
            </td>
            <td><div class="form-list">${formHtml}</div></td>
        `;

        tbody.appendChild(tr);
    });
}

function renderMatchHistory(matchList) {
    const matchContainer = document.getElementById("matchHistoryList");
    if (!matchContainer) return;

    matchContainer.innerHTML = "";

    if (matchList.length === 0) {
        matchContainer.innerHTML = `<div class="empty-state">No recent matches recorded.</div>`;
        return;
    }

    // Display newest matches first
    const reversedMatches = [...matchList].reverse();

    reversedMatches.forEach(match => {
        const card = document.createElement("div");
        card.className = "match-card";

        const upsetBadge = match.isUpset ? `<span class="upset-tag">🔥 UPSET</span>` : "";

        card.innerHTML = `
            <div class="match-details">
                <span class="match-winner">🏆 ${escapeHtml(match.winner)}</span>
                <span class="match-vs">vs</span>
                <span class="match-loser">${escapeHtml(match.loser)}</span>
                ${upsetBadge}
            </div>
            <div class="match-meta">
                <span class="match-score">Score: ${escapeHtml(match.score)}</span>
                <span class="match-elo">${escapeHtml(match.eloChange)}</span>
                <span class="match-date">${escapeHtml(match.date)}</span>
            </div>
        `;
        matchContainer.appendChild(card);
    });
}

function handleSearchAndFilter() {
    const searchVal = (document.getElementById("searchInput")?.value || "").toLowerCase();
    const sortVal = document.getElementById("sortSelect")?.value || "elo";

    let filtered = players.filter(p => p.name.toLowerCase().includes(searchVal));

    if (sortVal === "elo") {
        filtered.sort((a, b) => b.elo - a.elo);
    } else if (sortVal === "wins") {
        filtered.sort((a, b) => b.wins - a.wins);
    } else if (sortVal === "winrate") {
        filtered.sort((a, b) => {
            const rateA = (a.wins + a.losses) > 0 ? a.wins / (a.wins + a.losses) : 0;
            const rateB = (b.wins + b.losses) > 0 ? b.wins / (b.wins + b.losses) : 0;
            return rateB - rateA;
        });
    } else if (sortVal === "name") {
        filtered.sort((a, b) => a.name.localeCompare(b.name));
    }

    renderLeaderboard(filtered);
}

function showStatus(msg, type = "info") {
    const statusBanner = document.getElementById("statusBanner");
    if (!statusBanner) return;

    statusBanner.textContent = msg;
    statusBanner.className = `status-banner status-${type}`;
    statusBanner.style.display = "block";
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
