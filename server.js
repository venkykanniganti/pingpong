/**
 * Club Ping Pong ELO Server API & Static File Server (Node.js native http)
 * Contained in website_files/
 * Serves index.html, styles.css, app.js and provides /api/matches REST endpoints.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const MATCHES_FILE = path.join(DATA_DIR, 'matches.json');

// Ensure data directory and matches.json file exist inside website_files/data
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(MATCHES_FILE)) {
    fs.writeFileSync(MATCHES_FILE, JSON.stringify([], null, 2));
}

function readMatches() {
    try {
        const data = fs.readFileSync(MATCHES_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error("Error reading matches file:", err);
        return [];
    }
}

function writeMatches(matches) {
    try {
        fs.writeFileSync(MATCHES_FILE, JSON.stringify(matches, null, 2));
    } catch (err) {
        console.error("Error writing matches file:", err);
    }
}

const server = http.createServer((req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;

    // GET /api/matches
    if (pathname === '/api/matches' && req.method === 'GET') {
        const matches = readMatches();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, matches }));
        return;
    }

    // POST /api/matches - Record a new Best of 3 Match
    if (pathname === '/api/matches' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const { p1, p2, g1p1, g1p2, g2p1, g2p2, g3p1, g3p2, date, p1Elo, p2Elo } = data;

                if (!p1 || !p2 || p1.trim() === p2.trim()) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Select two different players.' }));
                    return;
                }

                // Validate Best of 3 Games
                let p1Wins = 0;
                let p2Wins = 0;
                const gameScoresArr = [];

                // Game 1
                const v1_1 = parseInt(g1p1, 10);
                const v1_2 = parseInt(g1p2, 10);
                if (isNaN(v1_1) || isNaN(v1_2)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Game 1 score is required.' }));
                    return;
                }
                if (v1_1 > v1_2) p1Wins++; else if (v1_2 > v1_1) p2Wins++;
                gameScoresArr.push(`${v1_1}-${v1_2}`);

                // Game 2
                const v2_1 = parseInt(g2p1, 10);
                const v2_2 = parseInt(g2p2, 10);
                if (isNaN(v2_1) || isNaN(v2_2)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Game 2 score is required.' }));
                    return;
                }
                if (v2_1 > v2_2) p1Wins++; else if (v2_2 > v2_1) p2Wins++;
                gameScoresArr.push(`${v2_1}-${v2_2}`);

                // Game 3 (if tied 1-1)
                if (p1Wins === 1 && p2Wins === 1) {
                    const v3_1 = parseInt(g3p1, 10);
                    const v3_2 = parseInt(g3p2, 10);
                    if (isNaN(v3_1) || isNaN(v3_2)) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, error: 'Game 3 is required when sets are tied 1-1.' }));
                        return;
                    }
                    if (v3_1 > v3_2) p1Wins++; else if (v3_2 > v3_1) p2Wins++;
                    gameScoresArr.push(`${v3_1}-${v3_2}`);
                }

                if (p1Wins !== 2 && p2Wins !== 2) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Best of 3 match must result in a 2-0 or 2-1 set score.' }));
                    return;
                }

                const isP1Winner = p1Wins === 2;
                const winner = isP1Winner ? p1.trim() : p2.trim();
                const loser = isP1Winner ? p2.trim() : p1.trim();
                const scoreDisplay = isP1Winner ? `${p1Wins} - ${p2Wins}` : `${p2Wins} - ${p1Wins}`;

                // Calculate estimated ELO shift (K=40, scaling=400)
                const r1 = parseInt(p1Elo, 10) || 1000;
                const r2 = parseInt(p2Elo, 10) || 1000;
                const e1 = 1 / (1 + Math.pow(10, (r2 - r1) / 400));
                const s1 = isP1Winner ? 1 : 0;
                const pointDiff = Math.round(40 * (s1 - e1));
                const absDiff = Math.abs(pointDiff);

                const isUpset = (isP1Winner && r1 < r2) || (!isP1Winner && r2 < r1);
                const matchDate = date ? date.trim() : new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });

                const newMatch = {
                    id: 'match_' + Date.now(),
                    date: matchDate,
                    p1: p1.trim(),
                    p2: p2.trim(),
                    winner,
                    loser,
                    score: scoreDisplay,
                    gameScores: gameScoresArr.join(', '),
                    status: 'unlogged',
                    isUpset,
                    eloChange: absDiff > 0 ? `+${absDiff} / -${absDiff}` : '+20 / -20',
                    createdAt: new Date().toISOString()
                };

                const matches = readMatches();
                matches.push(newMatch);
                writeMatches(matches);

                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, match: newMatch }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Invalid JSON payload.' }));
            }
        });
        return;
    }

    // POST /api/matches/reconcile - Mark matches logged when they appear in Google Sheet
    if (pathname === '/api/matches/reconcile' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { sheetMatches } = JSON.parse(body);
                if (!Array.isArray(sheetMatches)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'sheetMatches must be an array.' }));
                    return;
                }

                const serverMatches = readMatches();
                let updatedCount = 0;

                serverMatches.forEach(sm => {
                    if (sm.status === 'unlogged') {
                        const matchFound = sheetMatches.some(gm => {
                            const sameWinner = gm.winner.toLowerCase() === sm.winner.toLowerCase();
                            const sameLoser = gm.loser.toLowerCase() === sm.loser.toLowerCase();
                            const sameDate = !gm.date || !sm.date || gm.date === sm.date;
                            return sameWinner && sameLoser && sameDate;
                        });

                        if (matchFound) {
                            sm.status = 'logged';
                            sm.loggedAt = new Date().toISOString();
                            updatedCount++;
                        }
                    }
                });

                if (updatedCount > 0) {
                    writeMatches(serverMatches);
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, updatedCount, matches: serverMatches }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Invalid payload.' }));
            }
        });
        return;
    }

    // Serve static files from website_files/
    let reqPath = pathname === '/' ? '/index.html' : pathname;
    let filePath = path.join(__dirname, reqPath);

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'text/javascript',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.ico': 'image/x-icon'
        };

        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    });
});

server.listen(PORT, () => {
    console.log(`Ping Pong ELO Server running on port ${PORT}`);
});
