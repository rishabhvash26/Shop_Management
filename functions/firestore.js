// Initializes firebase-admin with no explicit project/host configuration.
// The Cloud Functions runtime and the Firebase emulator suite (`firebase
// emulators:start`) both inject the correct environment variables
// (GCLOUD_PROJECT, FIRESTORE_EMULATOR_HOST when applicable, and credentials)
// automatically, so this same code talks to the emulator locally and to
// real Firestore once deployed.

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

module.exports = { admin, db };
