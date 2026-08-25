export const getAdminInfo = () => {
    try {
        return JSON.parse(localStorage.getItem('adminInfo') || '{}');
    } catch {
        return {};
    }
};

export const hasPermission = (requiredPerm) => {
    if (!requiredPerm) return true;
    const adminInfo = getAdminInfo();
    if (adminInfo.role === 'admin') return true;
    const permissions = Array.isArray(adminInfo.permissions) ? adminInfo.permissions : [];
    if (permissions.includes(requiredPerm)) return true;
    // Legacy: users granted only "inventory" historically had full inventory rights
    if (
        (requiredPerm === 'inventory_edit' || requiredPerm === 'inventory_delete')
        && permissions.includes('inventory')
    ) {
        return true;
    }
    return false;
};
