/**
 * Role validation, normalization, and privilege-matching utility.
 * Standard system access roles: superadmin, admin, manager, ao, office_staff, cashier, support_staff.
 */

const VALID_ROLES = [
    'superadmin',
    'admin',
    'manager',
    'ao',
    'office_staff',
    'cashier',
    'support_staff',
];

const ROLE_LABELS = {
    superadmin: 'Super Admin',
    admin: 'Admin',
    manager: 'Manager',
    ao: 'AO (Administrative Officer)',
    office_staff: 'Office Staff',
    cashier: 'Cashier',
    support_staff: 'Support Staff',
};

const ROLE_ALIAS_MAP = {
    superadmin: 'superadmin',
    'super admin': 'superadmin',
    super_admin: 'superadmin',
    'super-admin': 'superadmin',
    admin: 'admin',
    administrator: 'admin',
    sysadmin: 'admin',
    system_admin: 'admin',
    manager: 'manager',
    dept_manager: 'manager',
    department_manager: 'manager',
    ao: 'ao',
    administrative_officer: 'ao',
    'administrative officer': 'ao',
    office_staff: 'office_staff',
    'office staff': 'office_staff',
    officestaff: 'office_staff',
    staff: 'office_staff',
    clerk: 'office_staff',
    cashier: 'cashier',
    accounts: 'cashier',
    accountant: 'cashier',
    fee_collector: 'cashier',
    support_staff: 'support_staff',
    'support staff': 'support_staff',
    support: 'support_staff',
    user: 'office_staff',
    user_role: 'office_staff',
    employee: 'office_staff',
    default: 'office_staff',
};

/**
 * Normalizes raw roles input to valid system role keys.
 * If raw roles are unmapped or invalid, matches against permissions/privileges.
 *
 * @param {Array<string>|string} rawRoles
 * @param {Array<string>} permissions
 * @returns {Array<string>} Array of validated standard role IDs
 */
function normalizeAndMatchRoles(rawRoles, permissions = []) {
    let inputList = [];
    if (Array.isArray(rawRoles)) {
        inputList = rawRoles;
    } else if (typeof rawRoles === 'string') {
        inputList = [rawRoles];
    }

    const matchedRoles = new Set();

    for (const item of inputList) {
        if (!item || typeof item !== 'string') continue;
        const cleaned = item.trim().toLowerCase();
        if (!cleaned) continue;

        if (ROLE_ALIAS_MAP[cleaned]) {
            matchedRoles.add(ROLE_ALIAS_MAP[cleaned]);
            continue;
        }

        if (cleaned.includes('super')) {
            matchedRoles.add('superadmin');
        } else if (cleaned.includes('admin')) {
            matchedRoles.add('admin');
        } else if (cleaned.includes('manager')) {
            matchedRoles.add('manager');
        } else if (cleaned === 'ao' || cleaned.includes('officer')) {
            matchedRoles.add('ao');
        } else if (cleaned.includes('cash') || cleaned.includes('account')) {
            matchedRoles.add('cashier');
        } else if (cleaned.includes('support')) {
            matchedRoles.add('support_staff');
        } else if (cleaned.includes('staff')) {
            matchedRoles.add('office_staff');
        }
    }

    // Privilege matching fallback if no known role was matched
    if (matchedRoles.size === 0) {
        const permSet = new Set(Array.isArray(permissions) ? permissions : []);
        if (permSet.has('all') || permSet.has('user_management') || permSet.has('settings')) {
            matchedRoles.add('admin');
        } else if (permSet.has('bus_management') || permSet.has('route_management') || permSet.has('inventory')) {
            matchedRoles.add('manager');
        } else if (permSet.has('communications') || permSet.has('gps_tracking')) {
            matchedRoles.add('ao');
        } else if (permSet.has('transport_dues') && permSet.size <= 2) {
            matchedRoles.add('cashier');
        } else {
            matchedRoles.add('office_staff');
        }
    }

    return Array.from(matchedRoles);
}

/**
 * Ensures user object has a valid normalized roles array.
 */
function normalizeUserRoles(user) {
    if (!user) return user;
    const rawRoles = user.roles || (user.is_superadmin ? ['superadmin'] : ['office_staff']);
    const permissions = user.permissions || [];
    const normalized = normalizeAndMatchRoles(rawRoles, permissions);
    return {
        ...user,
        roles: normalized.length > 0 ? normalized : ['office_staff'],
    };
}

module.exports = {
    VALID_ROLES,
    ROLE_LABELS,
    normalizeAndMatchRoles,
    normalizeUserRoles,
};
