const { mysqlPool } = require('../config/db');
const mongoose = require('mongoose');

const isMongoObjectId = (value) => {
    if (value instanceof mongoose.Types.ObjectId) return true;
    if (typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value)) return true;
    return false;
};

let legacyMongoToSqlCache = null;

const getLegacyMongoToSqlMap = async () => {
    if (legacyMongoToSqlCache) return legacyMongoToSqlCache;

    if (!mysqlPool) {
        legacyMongoToSqlCache = new Map();
        return legacyMongoToSqlCache;
    }

    try {
        const Campus = require('../models/Campus');
        const mongoCampuses = await Campus.find().lean();
        const [sqlRows] = await mysqlPool.query(
            'SELECT id, name, code FROM campuses WHERE is_active = 1'
        );

        const map = new Map();
        for (const mongoCampus of mongoCampuses) {
            const match = sqlRows.find((sqlCampus) =>
                sqlCampus.code?.toLowerCase() === mongoCampus.code?.toLowerCase()
                || sqlCampus.name?.toLowerCase() === mongoCampus.name?.toLowerCase()
            );
            if (match) {
                map.set(String(mongoCampus._id), match.id);
            }
        }

        legacyMongoToSqlCache = map;
        return map;
    } catch (err) {
        console.warn('MySQL getLegacyMongoToSqlMap query failed:', err.message);
        legacyMongoToSqlCache = new Map();
        return legacyMongoToSqlCache;
    }
};

const resolveCampusRefToSqlId = async (value) => {
    const sqlId = normalizeCampusId(value);
    if (sqlId !== null) return sqlId;
    if (!isMongoObjectId(value)) return null;
    const map = await getLegacyMongoToSqlMap();
    return map.get(String(value)) ?? null;
};

const parseCollegeIds = (value) => {
    if (Array.isArray(value)) {
        return value.map((id) => Number(id)).filter((id) => Number.isFinite(id));
    }
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed)
                ? parsed.map((id) => Number(id)).filter((id) => Number.isFinite(id))
                : [];
        } catch {
            return [];
        }
    }
    return [];
};

const normalizeCampusId = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
};

const normalizeCampusIds = (values = []) => (
    [...new Set(values.map(normalizeCampusId).filter((id) => id !== null))]
);

const mapCampusRow = (row, collegeNames = []) => ({
    _id: row.id,
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description || '',
    location: row.description || '',
    collegeIds: parseCollegeIds(row.college_ids),
    colleges: collegeNames,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
});

const getCollegeNamesByIds = async (collegeIds = []) => {
    if (!mysqlPool || collegeIds.length === 0) return [];
    try {
        const [rows] = await mysqlPool.query(
            'SELECT id, name FROM colleges WHERE id IN (?) AND is_active = 1 ORDER BY name ASC',
            [collegeIds]
        );
        return rows.map((row) => row.name);
    } catch (err) {
        console.warn('MySQL getCollegeNamesByIds failed:', err.message);
        return [];
    }
};

const resolveCollegeIdsFromNames = async (collegeNames = []) => {
    if (!mysqlPool || !collegeNames.length) return [];
    try {
        const [rows] = await mysqlPool.query(
            'SELECT id FROM colleges WHERE name IN (?) AND is_active = 1',
            [collegeNames]
        );
        return rows.map((row) => row.id);
    } catch (err) {
        console.warn('MySQL resolveCollegeIdsFromNames failed:', err.message);
        return [];
    }
};

const getAllCampuses = async ({ activeOnly = true } = {}) => {
    if (mysqlPool) {
        try {
            let sql = 'SELECT id, name, code, description, college_ids, is_active, created_at, updated_at FROM campuses';
            if (activeOnly) sql += ' WHERE is_active = 1';
            sql += ' ORDER BY name ASC';

            const [rows] = await mysqlPool.query(sql);
            const campuses = [];

            for (const row of rows) {
                const collegeIds = parseCollegeIds(row.college_ids);
                const collegeNames = await getCollegeNamesByIds(collegeIds);
                campuses.push(mapCampusRow(row, collegeNames));
            }

            return campuses;
        } catch (err) {
            console.warn('MySQL getAllCampuses query failed, falling back to MongoDB:', err.message);
        }
    }

    try {
        const Campus = require('../models/Campus');
        const mongoCampuses = await Campus.find().lean();
        return mongoCampuses.map((c) => ({
            _id: c._id,
            id: c._id,
            name: c.name,
            code: c.code,
            location: c.location || '',
            colleges: c.colleges || [],
            isActive: true,
        }));
    } catch (err) {
        console.error('MongoDB campuses query failed:', err.message);
        return [];
    }
};

const getCampusById = async (id, { activeOnly = false } = {}) => {
    const campusId = normalizeCampusId(id);
    if (mysqlPool && campusId !== null) {
        try {
            let sql = 'SELECT id, name, code, description, college_ids, is_active, created_at, updated_at FROM campuses WHERE id = ?';
            const params = [campusId];
            if (activeOnly) {
                sql += ' AND is_active = 1';
            }

            const [rows] = await mysqlPool.query(sql, params);
            if (rows.length) {
                const collegeIds = parseCollegeIds(rows[0].college_ids);
                const collegeNames = await getCollegeNamesByIds(collegeIds);
                return mapCampusRow(rows[0], collegeNames);
            }
        } catch (err) {
            console.warn('MySQL getCampusById failed:', err.message);
        }
    }

    if (id) {
        try {
            const Campus = require('../models/Campus');
            const c = await Campus.findById(id).lean();
            if (c) {
                return {
                    _id: c._id,
                    id: c._id,
                    name: c.name,
                    code: c.code,
                    location: c.location || '',
                    colleges: c.colleges || [],
                    isActive: true,
                };
            }
        } catch {}
    }
    return null;
};

const getCampusMapByIds = async (ids = []) => {
    const campusIds = normalizeCampusIds(ids);
    if (campusIds.length && mysqlPool) {
        try {
            const [rows] = await mysqlPool.query(
                'SELECT id, name, code, description, college_ids, is_active, created_at, updated_at FROM campuses WHERE id IN (?)',
                [campusIds]
            );

            const map = {};
            for (const row of rows) {
                const collegeIds = parseCollegeIds(row.college_ids);
                const collegeNames = await getCollegeNamesByIds(collegeIds);
                map[row.id] = mapCampusRow(row, collegeNames);
            }
            return map;
        } catch (err) {
            console.warn('MySQL getCampusMapByIds query failed:', err.message);
        }
    }

    try {
        const Campus = require('../models/Campus');
        const validObjectIds = (ids || []).filter(isMongoObjectId);
        if (!validObjectIds.length) return {};
        const mongoCampuses = await Campus.find({ _id: { $in: validObjectIds } }).lean();
        const map = {};
        for (const c of mongoCampuses) {
            map[String(c._id)] = {
                _id: c._id,
                id: c._id,
                name: c.name,
                code: c.code,
                location: c.location || '',
                colleges: c.colleges || [],
                isActive: true,
            };
        }
        return map;
    } catch {
        return {};
    }
};

const attachCampusToDocs = async (docs = [], field = 'campus') => {
    try {
        const plainDocs = docs.map((doc) => (doc?.toObject ? doc.toObject() : { ...doc }));
        const resolvedIds = await Promise.all(
            plainDocs.map((doc) => resolveCampusRefToSqlId(doc[field]))
        );
        const campusMap = await getCampusMapByIds(resolvedIds.filter((id) => id !== null));

        return plainDocs.map((doc, index) => ({
            ...doc,
            campus: resolvedIds[index] ? campusMap[resolvedIds[index]] || doc[field] || null : doc[field] || null
        }));
    } catch (err) {
        console.warn('attachCampusToDocs failed, returning plain docs:', err.message);
        return docs.map((doc) => (doc?.toObject ? doc.toObject() : { ...doc }));
    }
};

const attachCampusToDoc = async (doc, field = 'campus') => {
    const [result] = await attachCampusToDocs([doc], field);
    return result;
};

const getCollegesForCampuses = async (campusIds = []) => {
    const ids = normalizeCampusIds(campusIds);
    if (!mysqlPool || !ids.length) return [];

    const [rows] = await mysqlPool.query(
        'SELECT college_ids FROM campuses WHERE id IN (?) AND is_active = 1',
        [ids]
    );

    const collegeIdSet = new Set();
    rows.forEach((row) => {
        parseCollegeIds(row.college_ids).forEach((collegeId) => collegeIdSet.add(collegeId));
    });

    if (!collegeIdSet.size) return [];
    return getCollegeNamesByIds([...collegeIdSet]);
};

const createCampus = async ({ name, code, description = '', collegeIds = [], colleges = [] }) => {
    if (!mysqlPool) throw new Error('MySQL is not configured');

    let resolvedCollegeIds = normalizeCampusIds(collegeIds);
    if (!resolvedCollegeIds.length && colleges.length) {
        resolvedCollegeIds = await resolveCollegeIdsFromNames(colleges);
    }

    const [result] = await mysqlPool.query(
        'INSERT INTO campuses (name, code, description, college_ids, is_active) VALUES (?, ?, ?, ?, 1)',
        [name, code, description || '', JSON.stringify(resolvedCollegeIds)]
    );

    return getCampusById(result.insertId);
};

const updateCampus = async (id, { name, code, description, collegeIds, colleges }) => {
    const campusId = normalizeCampusId(id);
    if (!mysqlPool || campusId === null) return null;

    const existing = await getCampusById(campusId);
    if (!existing) return null;

    let resolvedCollegeIds = existing.collegeIds;
    if (collegeIds !== undefined) {
        resolvedCollegeIds = normalizeCampusIds(collegeIds);
    } else if (colleges !== undefined) {
        resolvedCollegeIds = await resolveCollegeIdsFromNames(colleges);
    }

    await mysqlPool.query(
        'UPDATE campuses SET name = ?, code = ?, description = ?, college_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [
            name ?? existing.name,
            code ?? existing.code,
            description !== undefined ? description : existing.description,
            JSON.stringify(resolvedCollegeIds),
            campusId
        ]
    );

    return getCampusById(campusId);
};

const deleteCampus = async (id) => {
    const campusId = normalizeCampusId(id);
    if (!mysqlPool || campusId === null) return false;

    await mysqlPool.query(
        'UPDATE campuses SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [campusId]
    );
    return true;
};

const buildCampusFilter = (user, queryCampusParam) => {
    const filter = {};
    const isSuperAdmin = user?.roles?.includes('superadmin');
    const queryCampusId = normalizeCampusId(queryCampusParam);
    const userCampusIds = normalizeCampusIds(user?.campuses || []);

    if (!isSuperAdmin && userCampusIds.length > 0) {
        if (queryCampusId !== null) {
            filter.campus = userCampusIds.includes(queryCampusId) ? queryCampusId : null;
        } else {
            filter.campus = { $in: userCampusIds };
        }
    } else if (queryCampusId !== null) {
        filter.campus = queryCampusId;
    }

    return filter;
};

module.exports = {
    parseCollegeIds,
    normalizeCampusId,
    normalizeCampusIds,
    getAllCampuses,
    getCampusById,
    getCampusMapByIds,
    attachCampusToDocs,
    attachCampusToDoc,
    getCollegesForCampuses,
    createCampus,
    updateCampus,
    deleteCampus,
    resolveCollegeIdsFromNames,
    buildCampusFilter
};
