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
    return Array.isArray(adminInfo.permissions) && adminInfo.permissions.includes(requiredPerm);
};
