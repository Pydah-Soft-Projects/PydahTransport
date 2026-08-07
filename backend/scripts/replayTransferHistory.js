const mongoose = require('mongoose');
const readline = require('readline');
const path = require('path');

// Load env variables just in case
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const LIVE_URI = process.env.LIVE_MONGO_URI;
if (!LIVE_URI) {
    console.error('Error: LIVE_MONGO_URI is not defined in .env file or as an environment variable.');
    process.exit(1);
}

// Import Models
const Route = require('../models/Route');
const Bus = require('../models/Bus');
const TransportRequest = require('../models/TransportRequest');
const EmployeeTransportRequest = require('../models/EmployeeTransportRequest');
const TransferHistory = require('../models/TransferHistory');

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

(async () => {
    const isSync = process.argv.includes('--sync');
    console.log('==================================================');
    console.log(`TRANSFER HISTORY REPLAY TOOL`);
    console.log('==================================================');
    console.log(`Target DB: Live Database (pydah_transport)`);
    console.log(`Mode:      ${isSync ? '🔴 SYNC & UPDATE LIVE DB' : '🟢 DRY RUN (READ-ONLY)'}`);
    console.log('==================================================\n');

    console.log('Connecting to Live Database...');
    await mongoose.connect(LIVE_URI);
    console.log('✓ Connected to Live Database successfully.\n');

    console.log('Fetching Transfer History entries...');
    // Sort by timestamp ascending (oldest first) so we replay them chronologically
    const historyEntries = await TransferHistory.find({}).sort({ timestamp: 1 }).lean();
    console.log(`Found ${historyEntries.length} transfer history logs to process.\n`);

    if (historyEntries.length === 0) {
        console.log('✅ No transfer history records found. Nothing to replay.');
        await mongoose.connection.close();
        process.exit(0);
    }

    if (isSync) {
        console.log('⚠️  WARNING: You are about to modify the LIVE database! ⚠️');
        console.log('This will replay all stage and passenger transfers chronologically.');
        const confirmSync = await askQuestion('Are you sure you want to run this? (yes/no): ');
        if (confirmSync !== 'yes' && confirmSync !== 'y') {
            console.log('❌ Replay cancelled by user.');
            await mongoose.connection.close();
            process.exit(0);
        }
        console.log('\nStarting live execution...\n');
    } else {
        console.log('Starting dry-run simulation...\n');
    }

    let successCount = 0;
    let failCount = 0;

    for (let index = 0; index < historyEntries.length; index++) {
        const entry = historyEntries[index];
        const logPrefix = `[Log #${index + 1}] [${new Date(entry.timestamp).toISOString()}]`;

        if (entry.type === 'stage') {
            console.log(`${logPrefix} STAGE TRANSFER: "${entry.sourceStageName}" from Route "${entry.sourceRouteId}" (${entry.sourceRouteName || 'N/A'}) to Route "${entry.destinationRouteId}" (${entry.destinationRouteName || 'N/A'})`);
            
            try {
                // Find Route documents
                const sourceRoute = await Route.findOne({ routeId: entry.sourceRouteId });
                const destRoute = await Route.findOne({ routeId: entry.destinationRouteId });

                if (!destRoute) {
                    console.log(`  ❌ Error: Destination route "${entry.destinationRouteId}" not found in database.`);
                    failCount++;
                    continue;
                }

                let stageToMove = null;
                if (sourceRoute) {
                    // Try to find stage in source route
                    stageToMove = sourceRoute.stages.find(s => s.stageName === entry.sourceStageName);
                }

                if (!stageToMove) {
                    // Stage might already be in destination route from a previous run or sync.
                    // Let's check if the destination route already has it.
                    const alreadyInDest = destRoute.stages.find(s => s.stageName === entry.sourceStageName);
                    if (alreadyInDest) {
                        console.log(`  ⚠️ Stage "${entry.sourceStageName}" is already in destination route "${entry.destinationRouteId}". Skipping route-level modification.`);
                        stageToMove = alreadyInDest;
                    } else {
                        console.log(`  ❌ Error: Stage "${entry.sourceStageName}" not found in source route "${entry.sourceRouteId}" and not in destination route.`);
                        failCount++;
                        continue;
                    }
                } else {
                    // Move stage from source to destination
                    if (!isSync) {
                        console.log(`  [Simulate] Move stage "${entry.sourceStageName}" from Route "${entry.sourceRouteId}" to Route "${entry.destinationRouteId}"`);
                    } else {
                        sourceRoute.stages = sourceRoute.stages.filter(s => s.stageName !== entry.sourceStageName);
                        destRoute.stages.push(stageToMove);
                        await sourceRoute.save();
                        await destRoute.save();
                        console.log(`  ✓ Route-level stages updated.`);
                    }
                }

                // Find available bus on destination route
                const availableBuses = await Bus.find({ assignedRouteId: entry.destinationRouteId }).select('busNumber').lean();
                const targetBusId = availableBuses.length > 0 ? availableBuses[0].busNumber : null;
                console.log(`  Bus allocation: Target bus for passengers is "${targetBusId || 'None (Unassigned)'}"`);

                // Update passengers
                console.log(`  Replaying updates for ${entry.passengers.length} passengers...`);
                let passengersUpdated = 0;

                for (const p of entry.passengers) {
                    const updateData = {
                        route_id: entry.destinationRouteId,
                        route_name: destRoute.routeName,
                        bus_id: targetBusId
                    };
                    if (p.status === 'approved') {
                        updateData.new_id_card_needed = true;
                    }

                    if (!isSync) {
                        console.log(`    [Simulate] Update ${p.type} "${p.name}" (${p.admissionNumber}) to Route "${entry.destinationRouteId}"`);
                        passengersUpdated++;
                    } else {
                        let result;
                        if (p.type === 'student') {
                            result = await TransportRequest.updateOne({ _id: p.passengerId }, { $set: updateData });
                        } else {
                            result = await EmployeeTransportRequest.updateOne({ _id: p.passengerId }, { $set: updateData });
                        }
                        
                        if (result.matchedCount > 0) {
                            passengersUpdated++;
                        } else {
                            console.log(`    ⚠️ Passenger "${p.name}" (${p.admissionNumber}, ID: ${p.passengerId}) not found in active requests.`);
                        }
                    }
                }

                console.log(`  ✓ Replayed stage transfer. Passengers updated: ${passengersUpdated}/${entry.passengers.length}`);
                successCount++;

            } catch (err) {
                console.error(`  ❌ Error replaying stage transfer:`, err.message);
                failCount++;
            }

        } else if (entry.type === 'passenger') {
            console.log(`${logPrefix} PASSENGER TRANSFER: ${entry.passengersCount} passengers from Route "${entry.sourceRouteId}" to Route "${entry.destinationRouteId}", Stage "${entry.destinationStageName}"`);
            
            try {
                const destRoute = await Route.findOne({ routeId: entry.destinationRouteId });
                if (!destRoute) {
                    console.log(`  ❌ Error: Destination route "${entry.destinationRouteId}" not found in database.`);
                    failCount++;
                    continue;
                }

                // Find available bus on destination route
                const availableBuses = await Bus.find({ assignedRouteId: entry.destinationRouteId }).select('busNumber').lean();
                const targetBusId = availableBuses.length > 0 ? availableBuses[0].busNumber : null;
                console.log(`  Bus allocation: Target bus for passengers is "${targetBusId || 'None (Unassigned)'}"`);

                console.log(`  Replaying updates for ${entry.passengers.length} passengers...`);
                let passengersUpdated = 0;

                for (const p of entry.passengers) {
                    const updateData = {
                        route_id: entry.destinationRouteId,
                        route_name: destRoute.routeName,
                        stage_name: entry.destinationStageName,
                        bus_id: targetBusId
                    };
                    if (p.status === 'approved') {
                        updateData.new_id_card_needed = true;
                    }

                    if (!isSync) {
                        console.log(`    [Simulate] Update ${p.type} "${p.name}" (${p.admissionNumber}) to Route "${entry.destinationRouteId}", Stage "${entry.destinationStageName}"`);
                        passengersUpdated++;
                    } else {
                        let result;
                        if (p.type === 'student') {
                            result = await TransportRequest.updateOne({ _id: p.passengerId }, { $set: updateData });
                        } else {
                            result = await EmployeeTransportRequest.updateOne({ _id: p.passengerId }, { $set: updateData });
                        }

                        if (result.matchedCount > 0) {
                            passengersUpdated++;
                        } else {
                            console.log(`    ⚠️ Passenger "${p.name}" (${p.admissionNumber}, ID: ${p.passengerId}) not found in active requests.`);
                        }
                    }
                }

                console.log(`  ✓ Replayed passenger transfer. Passengers updated: ${passengersUpdated}/${entry.passengers.length}`);
                successCount++;

            } catch (err) {
                console.error(`  ❌ Error replaying passenger transfer:`, err.message);
                failCount++;
            }
        }
        console.log('--------------------------------------------------');
    }

    console.log('\n==================================================');
    console.log(`REPLAY RUN COMPLETE`);
    console.log('==================================================');
    console.log(`Processed:       ${historyEntries.length} logs`);
    console.log(`Success:         ${successCount}`);
    console.log(`Failed:          ${failCount}`);
    console.log('==================================================\n');

    if (!isSync) {
        console.log('📢 THIS WAS A DRY RUN. No changes were written to the Live database.');
        console.log('👉 To synchronize and apply these changes, run with the --sync flag:');
        console.log('   node scripts/replayTransferHistory.js --sync\n');
    } else {
        console.log('🎉 Live database synchronized and all valid transfers replayed.');
    }

    await mongoose.connection.close();
    process.exit(0);

})().catch(async (err) => {
    console.error('An error occurred during execution:', err);
    await mongoose.connection.close();
    process.exit(1);
});
