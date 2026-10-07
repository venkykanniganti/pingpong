/**
 * Club Ping Pong ELO Leaderboard Application
 * Permanently linked to Google Spreadsheet:
 * https://docs.google.com/spreadsheets/d/e/2PACX-1vTlXSqdP61ab-ZPfFTBAgiB-BYZ-Pi9vBiJPfCJMybt7pYu2ZwPArH0hinsekARYgO3bTcuyeLCdbGM/pubhtml
 */

const PERMANENT_SPREADSHEET_ID = "2PACX-1vTlXSqdP61ab-ZPfFTBAgiB-BYZ-Pi9vBiJPfCJMybt7pYu2ZwPArH0hinsekARYgO3bTcuyeLCdbGM";
const RATINGS_GID = "1691595355";
const MATCH_LOG_GID = "0";

// Server API Endpoint
const API_BASE_URL = window.location.origin.includes('http') ? window.location.origin : 'http://localhost:3000';

// App State
let players = [];
let sheetMatches = [];
let pendingServerMatches = [];

document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

function initApp() {
    setupEventListeners();
    setupMatchForm();
    loadLiveSpreadsheet();
}

function getCsvUrl(sheetId, gid) {
    return `https://docs.google.com/spreadsheets/d/e/${sheetId}/pub?single=true&output=csv&gid=${gid}`;
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

    // Sync Sheet Button
    const refreshBtn = document.getElementById("refreshBtn");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", () => {
            loadLiveSpreadsheet();
        });
    }
}

// Fetch and sync live ratings & matches
async function loadLiveSpreadsheet() {
    showStatus("Syncing with Google Spreadsheet...", "info");

    const ratingsCsvUrl = getCsvUrl(PERMANENT_SPREADSHEET_ID, RATINGS_GID);
    const matchLogCsvUrl = getCsvUrl(PERMANENT_SPREADSHEET_ID, MATCH_LOG_GID);

    try {
        const [ratingsRes, matchLogRes, serverMatchesData] = await Promise.all([
            fetch(ratingsCsvUrl),
            fetch(matchLogCsvUrl),
            fetchServerMatches()
        ]);

        if (!ratingsRes.ok || !matchLogRes.ok) {
            throw new Error(`Ratings HTTP ${ratingsRes.status} | Match Log HTTP ${matchLogRes.status}`);
        }

        const ratingsCsvText = await ratingsRes.text();
        const matchLogCsvText = await matchLogRes.text();

        sheetMatches = parseMatchLogCsv(matchLogCsvText);
        const rawPlayers = parseRatingsCsv(ratingsCsvText);

        pendingServerMatches = serverMatchesData || [];

        // Deduplication & Reconciliation
        reconcileServerMatchesWithSheet(sheetMatches);

        const unloggedMatches = pendingServerMatches.filter(m => m.status === 'unlogged');
        const combinedMatches = [...sheetMatches, ...unloggedMatches];

        players = enrichPlayersWithStats(rawPlayers, combinedMatches);

        populatePlayerDropdowns(players);
        updateUI();

        showStatus(`Synced live data! ${players.length} players & ${sheetMatches.length} recorded matches.`, "success");
    } catch (err) {
        console.error("Error syncing data:", err);
        showStatus(`Unable to sync spreadsheet: ${err.message}`, "error");
    }
}

async function fetchServerMatches() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/matches`);
        if (res.ok) {
            const data = await res.json();
            if (data.success && Array.isArray(data.matches)) {
                return data.matches;
            }
        }
    } catch (e) {
        console.warn("Backend API offline, using localStorage fallback:", e);
    }

    const local = localStorage.getItem("pingpong_server_matches");
    return local ? JSON.parse(local) : [];
}

async function saveServerMatches(matchesList) {
    localStorage.setItem("pingpong_server_matches", JSON.stringify(matchesList));
}

async function reconcileServerMatchesWithSheet(sheetMatchesList) {
    let newlyLoggedCount = 0;

    pendingServerMatches.forEach(sm => {
        if (sm.status === 'unlogged') {
            const foundInSheet = sheetMatchesList.some(gm => {
                const sameWinner = gm.winner.toLowerCase() === sm.winner.toLowerCase();
                const sameLoser = gm.loser.toLowerCase() === sm.loser.toLowerCase();
                const sameDate = !gm.date || !sm.date || gm.date === sm.date;
                return sameWinner && sameLoser && sameDate;
            });

            if (foundInSheet) {
                sm.status = 'logged';
                sm.loggedAt = new Date().toISOString();
                newlyLoggedCount++;
            }
        }
    });

    if (newlyLoggedCount > 0) {
        saveServerMatches(pendingServerMatches);

        try {
            await fetch(`${API_BASE_URL}/api/matches/reconcile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sheetMatches: sheetMatchesList })
            });
        } catch (e) {
            // ignore API offline errors
        }

        showStatus(`Reconciled ${newlyLoggedCount} match(es) from Google Sheet!`, "success");
    }
}

// Setup Record Match (Best of 3) Form
function setupMatchForm() {
    const matchForm = document.getElementById("recordMatchForm");
    const dateInput = document.getElementById("matchDate");
    const g1p1 = document.getElementById("g1p1");
    const g1p2 = document.getElementById("g1p2");
    const g2p1 = document.getElementById("g2p1");
    const g2p2 = document.getElementById("g2p2");
    const g3p1 = document.getElementById("g3p1");
    const g3p2 = document.getElementById("g3p2");
    const p1Select = document.getElementById("matchP1");
    const p2Select = document.getElementById("matchP2");

    if (dateInput) {
        const today = new Date();
        dateInput.value = `${today.getMonth() + 1}/${today.getDate()}`;
    }

    const scoreInputs = [g1p1, g1p2, g2p1, g2p2, g3p1, g3p2, p1Select, p2Select];
    scoreInputs.forEach(input => {
        if (input) {
            input.addEventListener("input", updateMatchFormPreview);
        }
    });

    if (matchForm) {
        matchForm.addEventListener("submit", handleMatchFormSubmit);
    }
}

function updateMatchFormPreview() {
    const g1p1Val = parseInt(document.getElementById("g1p1").value, 10);
    const g1p2Val = parseInt(document.getElementById("g1p2").value, 10);
    const g2p1Val = parseInt(document.getElementById("g2p1").value, 10);
    const g2p2Val = parseInt(document.getElementById("g2p2").value, 10);
    const g3p1 = document.getElementById("g3p1");
    const g3p2 = document.getElementById("g3p2");
    const g3p1Val = parseInt(g3p1.value, 10);
    const g3p2Val = parseInt(g3p2.value, 10);
    
    const p1Name = document.getElementById("matchP1").value || "Player 1";
    const p2Name = document.getElementById("matchP2").value || "Player 2";
    const previewBox = document.getElementById("matchPreviewBox");
    const previewText = document.getElementById("previewText");

    let p1Wins = 0;
    let p2Wins = 0;

    if (!isNaN(g1p1Val) && !isNaN(g1p2Val)) {
        if (g1p1Val > g1p2Val) p1Wins++; else if (g1p2Val > g1p1Val) p2Wins++;
    }
    if (!isNaN(g2p1Val) && !isNaN(g2p2Val)) {
        if (g2p1Val > g2p2Val) p1Wins++; else if (g2p2Val > g2p1Val) p2Wins++;
    }

    // Enable Game 3 tiebreaker if split 1-1
    if (p1Wins === 1 && p2Wins === 1) {
        g3p1.disabled = false;
        g3p2.disabled = false;
        g3p1.required = true;
        g3p2.required = true;

        if (!isNaN(g3p1Val) && !isNaN(g3p2Val)) {
            if (g3p1Val > g3p2Val) p1Wins++; else if (g3p2Val > g3p1Val) p2Wins++;
        }
    } else {
        g3p1.disabled = true;
        g3p2.disabled = true;
        g3p1.required = false;
        g3p2.required = false;
        g3p1.value = "";
        g3p2.value = "";
    }

    if (p1Wins === 2 || p2Wins === 2) {
        const winner = p1Wins === 2 ? p1Name : p2Name;
        const setScore = p1Wins === 2 ? `${p1Wins} - ${p2Wins}` : `${p2Wins} - ${p1Wins}`;
        previewText.innerHTML = `🏆 Outcome: <strong>${escapeHtml(winner)}</strong> wins <strong>${setScore}</strong> (Best of 3)`;
        previewBox.style.display = "block";
    } else {
        previewBox.style.display = "none";
    }
}

async function handleMatchFormSubmit(e) {
    e.preventDefault();

    const dateVal = document.getElementById("matchDate").value.trim();
    const p1Name = document.getElementById("matchP1").value.trim();
    const p2Name = document.getElementById("matchP2").value.trim();
    const g1p1Val = document.getElementById("g1p1").value.trim();
    const g1p2Val = document.getElementById("g1p2").value.trim();
    const g2p1Val = document.getElementById("g2p1").value.trim();
    const g2p2Val = document.getElementById("g2p2").value.trim();
    const g3p1Val = document.getElementById("g3p1").value.trim();
    const g3p2Val = document.getElementById("g3p2").value.trim();

    if (!p1Name || !p2Name || p1Name === p2Name) {
        showStatus("Please select two different players for the match.", "error");
        return;
    }

    const p1Obj = players.find(p => p.name.toLowerCase() === p1Name.toLowerCase());
    const p2Obj = players.find(p => p.name.toLowerCase() === p2Name.toLowerCase());
    const p1Elo = p1Obj ? p1Obj.elo : 1000;
    const p2Elo = p2Obj ? p2Obj.elo : 1000;

    const payload = {
        date: dateVal,
        p1: p1Name,
        p2: p2Name,
        g1p1: g1p1Val,
        g1p2: g1p2Val,
        g2p1: g2p1Val,
        g2p2: g2p2Val,
        g3p1: g3p1Val,
        g3p2: g3p2Val,
        p1Elo,
        p2Elo
    };

    showStatus("Submitting match...", "info");

    try {
        const response = await fetch(`${API_BASE_URL}/api/matches`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            const result = await response.json();
            if (result.success && result.match) {
                pendingServerMatches.push(result.match);
            }
        } else {
            throw new Error("API response error");
        }
    } catch (err) {
        console.warn("API POST failed, using local match creation fallback:", err);
        const createdMatch = createLocalBestOfThreeMatch(payload);
        pendingServerMatches.push(createdMatch);
    }

    saveServerMatches(pendingServerMatches);

    const unloggedMatches = pendingServerMatches.filter(m => m.status === 'unlogged');
    const combinedMatches = [...sheetMatches, ...unloggedMatches];
    players = enrichPlayersWithStats(players, combinedMatches);

    updateUI();
    document.getElementById("recordMatchForm").reset();
    document.getElementById("matchPreviewBox").style.display = "none";

    showStatus(`Match recorded successfully! Logged internally as "unlogged".`, "success");
}

function createLocalBestOfThreeMatch(data) {
    const { p1, p2, g1p1, g1p2, g2p1, g2p2, g3p1, g3p2, date, p1Elo, p2Elo } = data;
    
    let p1Wins = 0;
    let p2Wins = 0;
    const gameArr = [];

    const v1_1 = parseInt(g1p1, 10);
    const v1_2 = parseInt(g1p2, 10);
    if (v1_1 > v1_2) p1Wins++; else p2Wins++;
    gameArr.push(`${v1_1}-${v1_2}`);

    const v2_1 = parseInt(g2p1, 10);
    const v2_2 = parseInt(g2p2, 10);
    if (v2_1 > v2_2) p1Wins++; else p2Wins++;
    gameArr.push(`${v2_1}-${v2_2}`);

    if (p1Wins === 1 && p2Wins === 1) {
        const v3_1 = parseInt(g3p1, 10);
        const v3_2 = parseInt(g3p2, 10);
        if (v3_1 > v3_2) p1Wins++; else p2Wins++;
        gameArr.push(`${v3_1}-${v3_2}`);
    }

    const isP1Winner = p1Wins === 2;
    const winner = isP1Winner ? p1 : p2;
    const loser = isP1Winner ? p2 : p1;
    const scoreDisplay = isP1Winner ? `${p1Wins} - ${p2Wins}` : `${p2Wins} - ${p1Wins}`;

    const r1 = parseInt(p1Elo, 10) || 1000;
    const r2 = parseInt(p2Elo, 10) || 1000;
    const isUpset = (isP1Winner && r1 < r2) || (!isP1Winner && r2 < r1);

    return {
        id: 'match_' + Date.now(),
        date: date || '10/7',
        p1,
        p2,
        winner,
        loser,
        score: scoreDisplay,
        gameScores: gameArr.join(', '),
        status: 'unlogged',
        isUpset,
        eloChange: '+20 / -20',
        createdAt: new Date().toISOString()
    };
}

function populatePlayerDropdowns(playerList) {
    const p1Select = document.getElementById("matchP1");
    const p2Select = document.getElementById("matchP2");
    if (!p1Select || !p2Select) return;

    const selectedP1 = p1Select.value;
    const selectedP2 = p2Select.value;

    p1Select.innerHTML = `<option value="">Select Player 1...</option>`;
    p2Select.innerHTML = `<option value="">Select Player 2...</option>`;

    playerList.forEach(p => {
        const opt1 = document.createElement("option");
        opt1.value = p.name;
        opt1.textContent = `${p.name} (${p.elo})`;
        p1Select.appendChild(opt1);

        const opt2 = document.createElement("option");
        opt2.value = p.name;
        opt2.textContent = `${p.name} (${p.elo})`;
        p2Select.appendChild(opt2);
    });

    p1Select.value = selectedP1;
    p2Select.value = selectedP2;
}

// Parse Ratings Sheet CSV
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
            id: 'sheet_' + i,
            date,
            p1,
            p2,
            winner: winnerName,
            loser: loserName,
            score: scoreDisplay,
            status: 'logged',
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

function enrichPlayersWithStats(playerList, matchLog) {
    const playerMap = {};

    playerList.forEach(p => {
        playerMap[p.name.toLowerCase()] = {
            ...p,
            wins: 0,
            losses: 0,
            form: []
        };
    });

    matchLog.forEach(match => {
        const winnerKey = match.winner.toLowerCase();
        const loserKey = match.loser.toLowerCase();

        if (playerMap[winnerKey]) {
            playerMap[winnerKey].wins++;
            playerMap[winnerKey].form.push("W");
        } else {
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

    const enrichedList = Object.values(playerMap).map(p => {
        const recentForm = p.form.slice(-5);
        return {
            ...p,
            form: recentForm.length > 0 ? recentForm : ["-"]
        };
    });

    enrichedList.sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        return b.elo - a.elo;
    });

    enrichedList.forEach((p, idx) => p.rank = idx + 1);

    return enrichedList;
}

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
    renderMatchHistory();
}

function renderStatsSummary() {
    const totalPlayersEl = document.getElementById("statTotalPlayers");
    const totalMatchesEl = document.getElementById("statTotalMatches");
    const topPlayerEl = document.getElementById("statTopPlayer");

    const unloggedCount = pendingServerMatches.filter(m => m.status === 'unlogged').length;

    if (totalPlayersEl) totalPlayersEl.textContent = players.length;
    if (totalMatchesEl) totalMatchesEl.textContent = `${sheetMatches.length + unloggedCount}`;

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
        tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No players found.</td></tr>`;
        return;
    }

    dataList.forEach(player => {
        const tr = document.createElement("tr");

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

        const totalGames = player.wins + player.losses;
        const winRate = totalGames > 0 ? Math.round((player.wins / totalGames) * 100) : 0;

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

function renderMatchHistory() {
    const matchContainer = document.getElementById("matchHistoryList");
    if (!matchContainer) return;

    matchContainer.innerHTML = "";

    const unloggedList = pendingServerMatches.filter(m => m.status === 'unlogged');
    const allMatchesCombined = [...unloggedList.reverse(), ...[...sheetMatches].reverse()];

    if (allMatchesCombined.length === 0) {
        matchContainer.innerHTML = `<div class="empty-state">No matches recorded.</div>`;
        return;
    }

    allMatchesCombined.forEach(match => {
        const card = document.createElement("div");
        const isUnlogged = match.status === 'unlogged';

        card.className = `match-card ${isUnlogged ? 'match-unlogged' : ''}`;

        const upsetBadge = match.isUpset ? `<span class="upset-tag">🔥 UPSET</span>` : "";
        const statusBadge = isUnlogged ? `<span class="status-tag pending">⏳ Pending</span>` : `<span class="status-tag logged">✅ Logged</span>`;

        card.innerHTML = `
            <div class="match-details">
                <span class="match-winner">🏆 ${escapeHtml(match.winner)}</span>
                <span class="match-vs">vs</span>
                <span class="match-loser">${escapeHtml(match.loser)}</span>
                ${upsetBadge}
                ${statusBadge}
            </div>
            <div class="match-meta">
                <span class="match-score">Score: ${escapeHtml(match.score)}</span>
                <span class="match-elo">${escapeHtml(match.eloChange || '+20 / -20')}</span>
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
