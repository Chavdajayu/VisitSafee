import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import importResidentsHandler from './api/importResidents.js';
import sendPushHandler from './api/send-push.js';
import updateRequestHandler from './api/update-request-status.js';
import visitorActionHandler from './api/visitor-action.js';

// Global error handlers
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const app = express();
app.use(cors());

// Middleware to support JSON bodies for handlers that need it
// Note: importResidents handles its own body parsing (formidable)
// But others might need body parsing.
app.use(express.json());

const adaptHandler = (handler) => async (req, res) => {
    try {
        await handler(req, res);
    } catch (e) {
        console.error("Handler Error:", e);
        if (!res.headersSent) {
            res.status(500).json({ error: "Internal Server Error" });
        }
    }
};

app.post('/api/importResidents', adaptHandler(importResidentsHandler));
app.post('/api/send-push', adaptHandler(sendPushHandler));
app.post('/api/update-request-status', adaptHandler(updateRequestHandler));
// visitor-action usually handles GET or POST, let's support both if unclear
app.all('/api/visitor-action', adaptHandler(visitorActionHandler));

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`API Server running on port ${PORT}`);
});
