// Initializes firebase-admin to talk ONLY to the local Firestore Emulator.
// No real Firebase project, no credentials, no billing.

const admin = require('firebase-admin');

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'demo-shop-management';
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8090';

// Must be set before initializing the app / calling firestore() so the
// admin SDK routes all requests to the emulator instead of production.
process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;
process.env.GCLOUD_PROJECT = PROJECT_ID;

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: PROJECT_ID,
  });
}

const db = admin.firestore();

module.exports = { admin, db, PROJECT_ID, EMULATOR_HOST };
