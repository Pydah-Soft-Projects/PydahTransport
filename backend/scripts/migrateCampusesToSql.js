/**
 * Migrate Mongo campus ObjectId references to SQL campus integer IDs.
 *
 * IMPORTANT: Buses/routes store campus as BSON ObjectId in MongoDB. The Mongoose
 * schema now expects Number, so model.find() returns campus as undefined even
 * though the data exists. This script reads raw collections to migrate correctly.
 *
 * Usage:
 *   node backend/scripts/migrateCampusesToSql.js --dry-run   # preview only
 *   node backend/scripts/migrateCampusesToSql.js               # apply changes
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose = require('mongoose');
const { connectDB, mysqlPool } = require('../config/db');
const Campus = require('../models/Campus');
const Bus = require('../models/Bus');
const Route = require('../models/Route');
const OtherVehicle = require('../models/OtherVehicle');
const UserRole = require('../models/UserRole');
const { normalizeCampusId } = require('../services/campusService');

const DRY_RUN = process.argv.includes('--dry-run');

const isMongoObjectId = (value) => {
    if (value instanceof mongoose.Types.ObjectId) return true;
    if (typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value)) return true;
    return false;
};

/** Resolve a campus reference to a SQL integer id, or null if unmappable. */
const resolveToSqlId = (value, map, knownSqlIds) => {
    if (value === null || value === undefined || value === '') return null;

    if (isMongoObjectId(value)) {
        return map.get(String(value)) ?? null;
    }

    const sqlId = normalizeCampusId(value);
    if (sqlId !== null && knownSqlIds.has(sqlId)) {
        return sqlId;
    }

    return null;
};

const formatCampusValue = (value) => {
    if (value instanceof mongoose.Types.ObjectId) return String(value);
    return String(value);
};

const buildMongoToSqlMap = async () => {
    const mongoCampuses = await Campus.find().lean();
    const [sqlRows] = await mysqlPool.query(
        'SELECT id, name, code FROM campuses WHERE is_active = 1'
    );

    const map = new Map();
    const knownSqlIds = new Set(sqlRows.map((row) => row.id));

    console.log('\n--- Campus mapping (Mongo -> SQL) ---');
    for (const mongoCampus of mongoCampuses) {
        const match = sqlRows.find((sqlCampus) =>
            sqlCampus.code?.toLowerCase() === mongoCampus.code?.toLowerCase()
            || sqlCampus.name?.toLowerCase() === mongoCampus.name?.toLowerCase()
        );

        if (match) {
            map.set(String(mongoCampus._id), match.id);
            console.log(`  "${mongoCampus.name}" (${mongoCampus._id}) -> SQL id ${match.id} (${match.code})`);
        } else {
            console.warn(`  No SQL match for Mongo campus "${mongoCampus.name}" [${mongoCampus.code}]`);
        }
    }

    console.log('\nSQL campuses available:');
    sqlRows.forEach((row) => console.log(`  id ${row.id}: ${row.name} (${row.code})`));

    return { map, knownSqlIds };
};

const migrateCollectionField = async ({
    collection,
    label,
    map,
    knownSqlIds,
    field = 'campus',
    identifierField = null,
}) => {
    const docs = await collection.find({ [field]: { $exists: true, $ne: null } }).toArray();
    let wouldUpdate = 0;
    let alreadyMigrated = 0;
    let unmapped = 0;

    console.log(`\n--- ${label} (${docs.length} documents with campus field) ---`);

    for (const doc of docs) {
        const current = doc[field];
        const identifier = identifierField ? doc[identifierField] : doc._id;
        const sqlId = resolveToSqlId(current, map, knownSqlIds);

        if (isMongoObjectId(current)) {
            if (!sqlId) {
                unmapped += 1;
                console.warn(`  [${label}] Cannot map ${identifier}: campus=${formatCampusValue(current)}`);
                continue;
            }

            wouldUpdate += 1;
            const prefix = DRY_RUN ? '[DRY RUN] Would update' : 'Updating';
            console.log(`  ${prefix} ${identifier}: ${formatCampusValue(current)} -> ${sqlId}`);

            if (!DRY_RUN) {
                await collection.updateOne({ _id: doc._id }, { $set: { [field]: sqlId } });
            }
            continue;
        }

        if (sqlId !== null) {
            alreadyMigrated += 1;
            continue;
        }

        unmapped += 1;
        console.warn(`  [${label}] Unknown campus value on ${identifier}: ${formatCampusValue(current)}`);
    }

    console.log(`  Summary: ${wouldUpdate} to update, ${alreadyMigrated} already SQL ids, ${unmapped} unmapped`);
    return { wouldUpdate, alreadyMigrated, unmapped };
};

const migrateUserRoles = async (map, knownSqlIds) => {
    const collection = UserRole.collection;
    const roles = await collection.find({ campuses: { $exists: true, $ne: [] } }).toArray();
    let wouldUpdate = 0;
    let alreadyMigrated = 0;
    let skipped = 0;

    console.log(`\n--- UserRole (${roles.length} roles with campus restrictions) ---`);

    for (const role of roles) {
        if (!Array.isArray(role.campuses)) {
            skipped += 1;
            console.warn(`  Skipping role ${role._id}: campuses is not an array`);
            continue;
        }

        const nextCampuses = [...new Set(
            role.campuses
                .map((campusId) => resolveToSqlId(campusId, map, knownSqlIds))
                .filter((campusId) => campusId !== null)
        )];

        const currentNormalized = [...new Set(
            role.campuses
                .map((campusId) => resolveToSqlId(campusId, map, knownSqlIds))
                .filter((campusId) => campusId !== null)
        )];

        const changed = JSON.stringify(nextCampuses) !== JSON.stringify(currentNormalized)
            || role.campuses.some((campusId) => isMongoObjectId(campusId));

        if (!changed) {
            alreadyMigrated += 1;
            continue;
        }

        wouldUpdate += 1;
        const prefix = DRY_RUN ? '[DRY RUN] Would update' : 'Updating';
        console.log(`  ${prefix} role ${role._id}: [${role.campuses.map(formatCampusValue).join(', ')}] -> [${nextCampuses.join(', ')}]`);

        if (!DRY_RUN) {
            await collection.updateOne({ _id: role._id }, { $set: { campuses: nextCampuses } });
        }
    }

    console.log(`  Summary: ${wouldUpdate} to update, ${alreadyMigrated} unchanged, ${skipped} skipped`);
    return { wouldUpdate, alreadyMigrated, skipped };
};

const run = async () => {
    if (!mysqlPool) {
        throw new Error('MySQL pool is not configured. Check MYSQL_* env vars.');
    }

    console.log(DRY_RUN
        ? '\n=== CAMPUS MIGRATION — DRY RUN (no data will be changed) ==='
        : '\n=== CAMPUS MIGRATION — LIVE RUN ===');

    await connectDB();
    const { map, knownSqlIds } = await buildMongoToSqlMap();

    if (map.size === 0) {
        console.warn('\nNo Mongo->SQL campus mappings found. Aborting.');
        await mongoose.connection.close();
        process.exit(1);
    }

    const busStats = await migrateCollectionField({
        collection: Bus.collection,
        label: 'Bus',
        map,
        knownSqlIds,
        identifierField: 'busNumber',
    });
    const routeStats = await migrateCollectionField({
        collection: Route.collection,
        label: 'Route',
        map,
        knownSqlIds,
        identifierField: 'routeId',
    });
    const vehicleStats = await migrateCollectionField({
        collection: OtherVehicle.collection,
        label: 'OtherVehicle',
        map,
        knownSqlIds,
        identifierField: 'vehicleNumber',
    });
    const roleStats = await migrateUserRoles(map, knownSqlIds);

    const totalUpdates = busStats.wouldUpdate + routeStats.wouldUpdate + vehicleStats.wouldUpdate + roleStats.wouldUpdate;

    console.log('\n=== Overall summary ===');
    console.log(`  Buses:          ${busStats.wouldUpdate} to update, ${busStats.alreadyMigrated} already migrated, ${busStats.unmapped} unmapped`);
    console.log(`  Routes:         ${routeStats.wouldUpdate} to update, ${routeStats.alreadyMigrated} already migrated, ${routeStats.unmapped} unmapped`);
    console.log(`  Other vehicles: ${vehicleStats.wouldUpdate} to update, ${vehicleStats.alreadyMigrated} already migrated, ${vehicleStats.unmapped} unmapped`);
    console.log(`  User roles:     ${roleStats.wouldUpdate} to update, ${roleStats.alreadyMigrated} unchanged`);
    console.log(`  Total records that ${DRY_RUN ? 'would be' : 'were'} updated: ${totalUpdates}`);

    if (DRY_RUN) {
        console.log('\nDry run complete. Re-run without --dry-run to apply changes.');
    } else {
        console.log('\nCampus migration completed.');
    }

    await mongoose.connection.close();
    process.exit(0);
};

run().catch(async (error) => {
    console.error('Campus migration failed:', error);
    await mongoose.connection.close();
    process.exit(1);
});
