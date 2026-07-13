require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { connectDB } = require('../config/db');

(async () => {
    await connectDB();
    const db = mongoose.connection.db;

    for (const num of ['AP26TB9702', 'AP21TW8820']) {
        const raw = await db.collection('buses').findOne({ busNumber: num });
        console.log(`\n=== RAW bus ${num} ===`);
        console.log('campus raw:', raw?.campus, 'type:', raw?.campus?.constructor?.name);
        console.log('assignedRouteId:', raw?.assignedRouteId);

        if (raw?.assignedRouteId) {
            const route = await db.collection('routes').findOne({ routeId: raw.assignedRouteId });
            console.log('route campus raw:', route?.campus, 'type:', route?.campus?.constructor?.name, 'routeName:', route?.routeName);
        }

        const viaMongoose = await require('../models/Bus').findOne({ busNumber: num });
        console.log('via Mongoose campus:', viaMongoose?.campus);
    }

    const oidBuses = await db.collection('buses').countDocuments({ campus: { $type: 'objectId' } });
    const numBuses = await db.collection('buses').countDocuments({ campus: { $type: 'number' } });
    const intBuses = await db.collection('buses').countDocuments({ campus: { $type: 'int' } });
    const doubleBuses = await db.collection('buses').countDocuments({ campus: { $type: 'double' } });
    console.log('\nBus campus BSON types: objectId=', oidBuses, 'number=', numBuses, 'int=', intBuses, 'double=', doubleBuses);

    const oidRoutes = await db.collection('routes').countDocuments({ campus: { $type: 'objectId' } });
    const numRoutes = await db.collection('routes').countDocuments({ campus: { $type: 'number' } });
    console.log('Route campus BSON types: objectId=', oidRoutes, 'number=', numRoutes);

    const objectIdBuses = await db.collection('buses').find({ campus: { $type: 'objectId' } }).limit(5).toArray();
    console.log('\nSample ObjectId buses:');
    objectIdBuses.forEach((b) => console.log(`  ${b.busNumber} -> ${b.campus}`));

    const roles = await db.collection('userroles').find({ campuses: { $exists: true, $ne: [] } }).limit(3).toArray();
    console.log('\nSample UserRole campuses (raw):');
    roles.forEach((r) => {
        console.log(`  role ${r._id}:`, r.campuses?.map((c) => [String(c), c?.constructor?.name]));
    });

    const isValid = (v) => mongoose.isValidObjectId(v);
    console.log('\nisValidObjectId checks: 1=', isValid(1), '2=', isValid(2), '"1"=', isValid('1'));

    await mongoose.connection.close();
})().catch(async (err) => {
    console.error(err);
    await mongoose.connection.close();
    process.exit(1);
});
