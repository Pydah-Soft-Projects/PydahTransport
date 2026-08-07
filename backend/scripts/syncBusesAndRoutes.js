const mongoose = require('mongoose');
const readline = require('readline');
const path = require('path');

// Load env variables just in case
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const LIVE_URI = process.env.LIVE_MONGO_URI;
const TESTING_URI = process.env.TESTING_MONGO_URI;

if (!LIVE_URI) {
    console.error('Error: LIVE_MONGO_URI is not defined in .env file or as an environment variable.');
    process.exit(1);
}
if (!TESTING_URI) {
    console.error('Error: TESTING_MONGO_URI is not defined in .env file or as an environment variable.');
    process.exit(1);
}

// Load models to register schemas
const Bus = require('../models/Bus');
const Route = require('../models/Route');

const BusSchema = Bus.schema;
const RouteSchema = Route.schema;

const askQuestion = (query) => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise(resolve => rl.question(query, answer => {
        rl.close();
        resolve(answer.trim().toLowerCase());
    }));
};

// Helper for deep equality comparison, ignoring mongoose system fields
function deepEqual(val1, val2) {
    if (val1 === val2) return true;
    
    if (typeof val1 !== typeof val2 || val1 === null || val2 === null) {
        return false;
    }
    
    if (typeof val1 === 'object') {
        // Handle Date objects
        if (val1 instanceof Date || val2 instanceof Date) {
            return new Date(val1).getTime() === new Date(val2).getTime();
        }
        
        // Handle arrays
        const isArr1 = Array.isArray(val1);
        const isArr2 = Array.isArray(val2);
        if (isArr1 !== isArr2) return false;
        
        if (isArr1) {
            if (val1.length !== val2.length) return false;
            for (let i = 0; i < val1.length; i++) {
                if (!deepEqual(val1[i], val2[i])) return false;
            }
            return true;
        }
        
        // Handle objects
        const keys1 = Object.keys(val1).filter(k => !['_id', '__v', 'createdAt', 'updatedAt', 'id'].includes(k));
        const keys2 = Object.keys(val2).filter(k => !['_id', '__v', 'createdAt', 'updatedAt', 'id'].includes(k));
        
        for (const key of keys1) {
            if (!keys2.includes(key)) {
                // If the key is absent in one but is falsy/empty array in the other, consider it equal
                if (!val1[key] || (Array.isArray(val1[key]) && val1[key].length === 0)) continue;
                return false;
            }
            if (!deepEqual(val1[key], val2[key])) return false;
        }
        for (const key of keys2) {
            if (!keys1.includes(key)) {
                if (!val2[key] || (Array.isArray(val2[key]) && val2[key].length === 0)) continue;
                return false;
            }
        }
        return true;
    }
    
    return false;
}

// Function to find differences between two objects for detailed mismatch reporting
function getMismatchedFields(objTest, objLive) {
    const mismatches = {};
    const keys = new Set([
        ...Object.keys(objTest).filter(k => !['_id', '__v', 'createdAt', 'updatedAt', 'id'].includes(k)),
        ...Object.keys(objLive).filter(k => !['_id', '__v', 'createdAt', 'updatedAt', 'id'].includes(k))
    ]);

    for (const key of keys) {
        const valTest = objTest[key];
        const valLive = objLive[key];
        if (!deepEqual(valTest, valLive)) {
            mismatches[key] = {
                testing: valTest,
                live: valLive
            };
        }
    }
    return mismatches;
}

(async () => {
    const isSync = process.argv.includes('--sync');
    console.log('==================================================');
    console.log(`DATABASE RECONCILIATION & SYNC TOOL`);
    console.log('==================================================');
    console.log(`Mode: ${isSync ? '🔴 SYNC & MODIFY' : '🟢 DRY RUN (READ-ONLY)'}`);
    console.log('==================================================\n');

    console.log('Connecting to Testing Database...');
    const connTesting = mongoose.createConnection(TESTING_URI);
    await connTesting.asPromise();
    console.log('✓ Connected to Testing Database successfully.\n');

    console.log('Connecting to Live Database...');
    const connLive = mongoose.createConnection(LIVE_URI);
    await connLive.asPromise();
    console.log('✓ Connected to Live Database successfully.\n');

    // Bind models
    const TestBus = connTesting.model('Bus', BusSchema);
    const TestRoute = connTesting.model('Route', RouteSchema);

    const LiveBus = connLive.model('Bus', BusSchema);
    const LiveRoute = connLive.model('Route', RouteSchema);

    console.log('Fetching collections data...');
    const testBuses = await TestBus.find({}).lean();
    const testRoutes = await TestRoute.find({}).lean();
    const liveBuses = await LiveBus.find({}).lean();
    const liveRoutes = await LiveRoute.find({}).lean();

    console.log(`\nTesting DB Status: ${testBuses.length} Buses, ${testRoutes.length} Routes`);
    console.log(`Live DB Status:    ${liveBuses.length} Buses, ${liveRoutes.length} Routes`);
    console.log('--------------------------------------------------\n');

    // 1. Reconcile Buses
    console.log('Analyzing BUSES...');
    const missingBuses = []; // In Testing but not in Live
    const extraBuses = [];   // In Live but not in Testing
    const mismatchedBuses = []; // In both but different

    const testBusMap = new Map(testBuses.map(b => [b.busNumber, b]));
    const liveBusMap = new Map(liveBuses.map(b => [b.busNumber, b]));

    // Find missing and mismatched
    for (const [busNumber, tBus] of testBusMap.entries()) {
        if (!liveBusMap.has(busNumber)) {
            missingBuses.push(tBus);
        } else {
            const lBus = liveBusMap.get(busNumber);
            if (!deepEqual(tBus, lBus)) {
                mismatchedBuses.push({
                    busNumber,
                    testing: tBus,
                    live: lBus,
                    diff: getMismatchedFields(tBus, lBus)
                });
            }
        }
    }

    // Find extra
    for (const [busNumber, lBus] of liveBusMap.entries()) {
        if (!testBusMap.has(busNumber)) {
            extraBuses.push(lBus);
        }
    }

    console.log(`Buses analysis completed:`);
    console.log(`  - Missing in Live (to add):       ${missingBuses.length}`);
    console.log(`  - Extra in Live (to delete?):    ${extraBuses.length}`);
    console.log(`  - Mismatched details (to update): ${mismatchedBuses.length}`);
    console.log('--------------------------------------------------\n');

    // 2. Reconcile Routes
    console.log('Analyzing ROUTES...');
    const missingRoutes = []; // In Testing but not in Live
    const extraRoutes = [];   // In Live but not in Testing
    const mismatchedRoutes = []; // In both but different

    const testRouteMap = new Map(testRoutes.map(r => [r.routeId, r]));
    const liveRouteMap = new Map(liveRoutes.map(r => [r.routeId, r]));

    // Find missing and mismatched
    for (const [routeId, tRoute] of testRouteMap.entries()) {
        if (!liveRouteMap.has(routeId)) {
            missingRoutes.push(tRoute);
        } else {
            const lRoute = liveRouteMap.get(routeId);
            if (!deepEqual(tRoute, lRoute)) {
                mismatchedRoutes.push({
                    routeId,
                    testing: tRoute,
                    live: lRoute,
                    diff: getMismatchedFields(tRoute, lRoute)
                });
            }
        }
    }

    // Find extra
    for (const [routeId, lRoute] of liveRouteMap.entries()) {
        if (!testRouteMap.has(routeId)) {
            extraRoutes.push(lRoute);
        }
    }

    console.log(`Routes analysis completed:`);
    console.log(`  - Missing in Live (to add):       ${missingRoutes.length}`);
    console.log(`  - Extra in Live (to delete?):    ${extraRoutes.length}`);
    console.log(`  - Mismatched details (to update): ${mismatchedRoutes.length}`);
    console.log('==================================================\n');

    // 3. Print Discrepancy Details
    if (missingBuses.length > 0) {
        console.log('📌 BUSES MISSING IN LIVE:');
        missingBuses.forEach(b => console.log(`  - Bus ${b.busNumber} (${b.vehicleModel || 'No Model'}, Capacity: ${b.capacity})`));
        console.log('');
    }

    if (mismatchedBuses.length > 0) {
        console.log('📌 BUSES WITH MISMATCHED DETAILS:');
        mismatchedBuses.forEach(m => {
            console.log(`  - Bus ${m.busNumber}:`);
            for (const field in m.diff) {
                console.log(`      * ${field}: Testing => ${JSON.stringify(m.diff[field].testing)}, Live => ${JSON.stringify(m.diff[field].live)}`);
            }
        });
        console.log('');
    }

    if (extraBuses.length > 0) {
        console.log('📌 EXTRA BUSES IN LIVE (NOT IN TESTING):');
        extraBuses.forEach(b => console.log(`  - Bus ${b.busNumber} (${b.vehicleModel || 'No Model'}, Capacity: ${b.capacity})`));
        console.log('');
    }

    if (missingRoutes.length > 0) {
        console.log('📌 ROUTES MISSING IN LIVE:');
        missingRoutes.forEach(r => console.log(`  - Route ${r.routeId} (${r.routeName}: ${r.startPoint} -> ${r.endPoint})`));
        console.log('');
    }

    if (mismatchedRoutes.length > 0) {
        console.log('📌 ROUTES WITH MISMATCHED DETAILS:');
        mismatchedRoutes.forEach(m => {
            console.log(`  - Route ${m.routeId} (${m.testing.routeName}):`);
            for (const field in m.diff) {
                console.log(`      * ${field}: Testing => ${JSON.stringify(m.diff[field].testing)}, Live => ${JSON.stringify(m.diff[field].live)}`);
            }
        });
        console.log('');
    }

    if (extraRoutes.length > 0) {
        console.log('📌 EXTRA ROUTES IN LIVE (NOT IN TESTING):');
        extraRoutes.forEach(r => console.log(`  - Route ${r.routeId} (${r.routeName}: ${r.startPoint} -> ${r.endPoint})`));
        console.log('');
    }

    const totalDiscrepancies = missingBuses.length + extraBuses.length + mismatchedBuses.length +
                               missingRoutes.length + extraRoutes.length + mismatchedRoutes.length;

    if (totalDiscrepancies === 0) {
        console.log('✅ Excellent! Testing DB and Live DB are perfectly in sync for Buses and Routes.');
        await connTesting.close();
        await connLive.close();
        process.exit(0);
    }

    if (!isSync) {
        console.log('📢 THIS WAS A DRY RUN. No changes were written to the Live database.');
        console.log('👉 To synchronize, run the script with the --sync flag:');
        console.log('   node backend/scripts/syncBusesAndRoutes.js --sync\n');
        await connTesting.close();
        await connLive.close();
        process.exit(0);
    }

    // 4. Sync Actions (Interactive Prompt)
    console.log('⚠️  WARNING: You are about to modify the LIVE database! ⚠️');
    const confirmSync = await askQuestion('Are you sure you want to sync Live DB with Testing DB? (yes/no): ');
    
    if (confirmSync !== 'yes' && confirmSync !== 'y') {
        console.log('❌ Sync cancelled by user.');
        await connTesting.close();
        await connLive.close();
        process.exit(0);
    }

    let deleteExtras = false;
    if (extraBuses.length > 0 || extraRoutes.length > 0) {
        const confirmDelete = await askQuestion('Do you want to delete extra buses/routes in Live DB that do not exist in Testing DB? (yes/no): ');
        if (confirmDelete === 'yes' || confirmDelete === 'y') {
            deleteExtras = true;
        }
    }

    console.log('\n--- EXECUTION START ---');

    // A. Sync Buses
    if (missingBuses.length > 0) {
        console.log(`Inserting ${missingBuses.length} missing buses into Live DB...`);
        // Remove mongoose internal metadata if any before insert
        const busesToInsert = missingBuses.map(b => {
            const clean = { ...b };
            delete clean._id;
            delete clean.createdAt;
            delete clean.updatedAt;
            return clean;
        });
        await LiveBus.insertMany(busesToInsert);
        console.log('✓ Missing buses inserted.');
    }

    if (mismatchedBuses.length > 0) {
        console.log(`Updating ${mismatchedBuses.length} mismatched buses in Live DB...`);
        for (const item of mismatchedBuses) {
            const updateData = { ...item.testing };
            delete updateData._id;
            delete updateData.createdAt;
            delete updateData.updatedAt;
            await LiveBus.updateOne({ busNumber: item.busNumber }, updateData);
            console.log(`  ✓ Updated Bus ${item.busNumber}`);
        }
        console.log('✓ Mismatched buses updated.');
    }

    if (extraBuses.length > 0 && deleteExtras) {
        console.log(`Deleting ${extraBuses.length} extra buses from Live DB...`);
        const extraBusNumbers = extraBuses.map(b => b.busNumber);
        await LiveBus.deleteMany({ busNumber: { $in: extraBusNumbers } });
        console.log('✓ Extra buses deleted.');
    }

    // B. Sync Routes
    if (missingRoutes.length > 0) {
        console.log(`Inserting ${missingRoutes.length} missing routes into Live DB...`);
        const routesToInsert = missingRoutes.map(r => {
            const clean = { ...r };
            delete clean._id;
            delete clean.createdAt;
            delete clean.updatedAt;
            return clean;
        });
        await LiveRoute.insertMany(routesToInsert);
        console.log('✓ Missing routes inserted.');
    }

    if (mismatchedRoutes.length > 0) {
        console.log(`Updating ${mismatchedRoutes.length} mismatched routes in Live DB...`);
        for (const item of mismatchedRoutes) {
            const updateData = { ...item.testing };
            delete updateData._id;
            delete updateData.createdAt;
            delete updateData.updatedAt;
            await LiveRoute.updateOne({ routeId: item.routeId }, updateData);
            console.log(`  ✓ Updated Route ${item.routeId}`);
        }
        console.log('✓ Mismatched routes updated.');
    }

    if (extraRoutes.length > 0 && deleteExtras) {
        console.log(`Deleting ${extraRoutes.length} extra routes from Live DB...`);
        const extraRouteIds = extraRoutes.map(r => r.routeId);
        await LiveRoute.deleteMany({ routeId: { $in: extraRouteIds } });
        console.log('✓ Extra routes deleted.');
    }

    console.log('\n==================================================');
    console.log('🎉 SYNC COMPLETE! Live DB is now aligned with Testing DB.');
    console.log('==================================================\n');

    await connTesting.close();
    await connLive.close();
    process.exit(0);

})().catch(async (err) => {
    console.error('An error occurred during execution:', err);
    process.exit(1);
});
