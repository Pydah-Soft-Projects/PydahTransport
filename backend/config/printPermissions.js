const ALLOWED_TEMPLATES = {
    'admissions': ['transport-admit', 'transport-bus-idcard-sheet'],
    'fee-management': ['bill-print'],
    'transport-frontend': ['*'] // Wildcard allows all templates
};

module.exports = {
    ALLOWED_TEMPLATES
};
