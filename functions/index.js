const { onRequest } = require('firebase-functions/v2/https');
const app = require('./app');

// Deployed as a single Cloud Function named "api". Firebase Hosting rewrites
// /api/** to this function (see firebase.json), so the frontend's existing
// fetch('/api/...') calls work unchanged in production.
exports.api = onRequest(app);
