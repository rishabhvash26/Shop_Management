// Thin local-dev entry point: runs the same Express app that gets deployed
// as a Cloud Function (functions/app.js), as a plain Node process talking to
// the Firestore Emulator. Nothing here ships to production.

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'demo-shop-management';
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8090';

// Must be set before requiring functions/app.js (which initializes
// firebase-admin) so the Admin SDK routes requests to the emulator.
process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const app = require('../functions/app');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Shop Management server listening on http://localhost:${PORT}`);
  console.log(`Connected to Firestore emulator at ${EMULATOR_HOST}`);
});
