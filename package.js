const express = require('express');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 7860;
const ACCESS_KEY = process.env.PROXY_SECRET_KEY || "fallback_default_key";

let espSocket = null;
const pendingRequests = new Map();
app.use(express.raw({ type: '*/*', limit: '10mb' }));

const server = app.listen(PORT, () => {
    console.log(`Secured Proxy Gateway running on port ${PORT}`);
});

const wss = new WebSocketServer({ server, path: '/esp-bridge' });
wss.on('connection', (ws) => {
    console.log('[SYSTEM] ESP8266 connected over WebSocket.');
    espSocket = ws;

    ws.on('message', (message) => {
        try {
            const rawString = message.toString();

            // Handle hardware keep-alive ping requests smoothly
            if (rawString === '{"type":"ping"}') {
                ws.send(JSON.stringify({ type: 'pong' }));
                return;
            }

            // ==========================================================
            // 100% JSON-FREE OUTBOUND TEXT SPLITTING ROUTER
            // ==========================================================
            // Splits the payload returned by your hardware using the strict string delimiter
            const parts = rawString.split('|||DATA_SEP|||');
            if (parts.length >= 3) {
                const txId = parts[0];
                const statusCode = parseInt(parts[1], 10) || 200;
                const bodyPayload = parts[2];

                const res = pendingRequests.get(txId);
                if (res) {
                    res.status(statusCode);
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    res.send(bodyPayload);
                    pendingRequests.delete(txId);
                }
            }
        } catch (err) {
            console.error('WS payload parsing error:', err);
        }
    });

    ws.on('close', () => {
        if (espSocket === ws) espSocket = null;
    });
});

app.all('*', (req, res) => {
    const providedKey = req.query.key;
    if (!providedKey || providedKey !== ACCESS_KEY) {
        return res.status(401).send('<h1>401 Unauthorized</h1><p>Invalid Security Key.</p>');
    }
    if (!espSocket || espSocket.readyState !== 1) {
        return res.status(503).send('<h1>503 Service Unavailable</h1><p>ESP8266 Offline.</p>');
    }

    const txId = crypto.randomUUID();
    pendingRequests.set(txId, res);

    // Send the raw text layout line using standard pipe tracking delimiters down to hardware
    const flatPayload = `${txId}|${req.method}|${req.url}`;
    espSocket.send(flatPayload);

    setTimeout(() => {
        if (pendingRequests.has(txId)) {
            pendingRequests.delete(txId);
            res.status(504).send('<h1>504 Gateway Timeout</h1>');
        }
    }, 15000);
});
