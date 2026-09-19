const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const UserRole = require('../models/UserRole');
const { normalizeAndMatchRoles } = require('../utils/roleUtils');

async function normalizeAllUserRoles() {
    try {
        if (mongoose.connection.readyState !== 1) {
            await mongoose.connect(process.env.MONGO_URI);
        }

        const allUserRoles = await UserRole.find({});
        let updatedCount = 0;

        for (const doc of allUserRoles) {
            const rawRoles = doc.roles || [];
            const perms = doc.permissions || [];
            const normalized = normalizeAndMatchRoles(rawRoles, perms);

            const isDifferent =
                rawRoles.length !== normalized.length ||
                rawRoles.some((r, idx) => r !== normalized[idx]);

            if (isDifferent) {
                doc.roles = normalized.length > 0 ? normalized : ['user'];
                await doc.save();
                updatedCount++;
                console.log(`[RoleMigration] Updated UserRole ID ${doc._id}: ${JSON.stringify(rawRoles)} -> ${JSON.stringify(normalized)}`);
            }
        }

        console.log(`[RoleMigration] Completed. Updated ${updatedCount} UserRole record(s).`);
        return { totalScanned: allUserRoles.length, updatedCount };
    } catch (err) {
        console.error('[RoleMigration] Error normalizing UserRoles in DB:', err);
        return { error: err.message };
    }
}

if (require.main === module) {
    normalizeAllUserRoles().then(() => mongoose.disconnect());
}

module.exports = { normalizeAllUserRoles };
