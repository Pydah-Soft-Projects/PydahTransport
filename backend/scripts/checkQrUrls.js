const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Paths to env files
const backendEnvPath = path.join(__dirname, '..', '.env');
const frontendEnvPath = path.join(__dirname, '..', '..', 'frontend', '.env');

console.log('===========================================================');
console.log('          QR CODE & SITE URL CONFIGURATION CHECKER          ');
console.log('===========================================================');

// 1. Read Backend Env
let backendEnv = {};
if (fs.existsSync(backendEnvPath)) {
    const envConfig = dotenv.parse(fs.readFileSync(backendEnvPath));
    backendEnv = envConfig;
    console.log('✓ Found Backend .env file');
} else {
    console.log('X Backend .env file not found at:', backendEnvPath);
}

// 2. Read Frontend Env
let frontendEnv = {};
if (fs.existsSync(frontendEnvPath)) {
    const envConfig = dotenv.parse(fs.readFileSync(frontendEnvPath));
    frontendEnv = envConfig;
    console.log('✓ Found Frontend .env file');
} else {
    console.log('X Frontend .env file not found at:', frontendEnvPath);
}

console.log('\n--- Configuration Values ---');
const crmBackendUrl = backendEnv.CRM_BACKEND_URL || 'NOT SET';
const publicSiteUrl = backendEnv.PUBLIC_SITE_URL || 'NOT SET';
const port = backendEnv.PORT || '5001';
const viteApiUrl = frontendEnv.VITE_API_URL || 'NOT SET';
const viteCrmUrl = frontendEnv.VITE_CRM_URL || 'NOT SET';
const vitePublicSiteUrl = frontendEnv.VITE_PUBLIC_SITE_URL || 'NOT SET';

console.log(`[Backend] CRM_BACKEND_URL:      ${crmBackendUrl}`);
console.log(`[Backend] PUBLIC_SITE_URL:      ${publicSiteUrl}`);
console.log(`[Backend] PORT:                 ${port}`);
console.log(`[Frontend] VITE_API_URL:        ${viteApiUrl}`);
console.log(`[Frontend] VITE_CRM_URL:        ${viteCrmUrl}`);
console.log(`[Frontend] VITE_PUBLIC_SITE_URL: ${vitePublicSiteUrl}`);

console.log('\n--- QR URL Evaluation ---');
console.log('In backend/services/print.service.js, QR codes verifyBase is resolved as:');
console.log('`process.env.PUBLIC_SITE_URL || process.env.CRM_BACKEND_URL || \'\'`');

const sampleId = '654321fedcba09876543210f';
const currentBackendQrUrl = `${publicSiteUrl !== 'NOT SET' ? publicSiteUrl : crmBackendUrl}/verify-transport/${sampleId}`;
const proposedCorrectQrUrl = `${vitePublicSiteUrl}/verify-transport/${sampleId}`;

console.log(`\n👉 SCANNING THE GENERATED QR ON ID CARD WILL OPEN:`);
console.log(`   ${currentBackendQrUrl}`);

console.log(`\n👉 TARGET FRONTEND SITE EXPECTED URL:`);
console.log(`   ${proposedCorrectQrUrl}`);

console.log('\n--- Diagnostic Results ---');
if (publicSiteUrl === 'NOT SET') {
    console.log('⚠️  PUBLIC_SITE_URL is not set in backend/.env.');
    console.log('   The backend is falling back to CRM_BACKEND_URL which points to the API backend.');
    console.log('   Users scanning the QR code will get a 404 error.');
} else if (publicSiteUrl !== vitePublicSiteUrl) {
    console.log('⚠️  MISMATCH DETECTED:');
    console.log(`   Backend PUBLIC_SITE_URL (${publicSiteUrl}) does not match Frontend VITE_PUBLIC_SITE_URL (${vitePublicSiteUrl}).`);
} else {
    console.log('✓ Configuration is correct! QR code URLs match the frontend site.');
}
console.log('===========================================================');
