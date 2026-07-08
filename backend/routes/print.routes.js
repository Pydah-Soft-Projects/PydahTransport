const express = require('express');
const router = express.Router();
const printAuthentication = require('../middleware/printAuthentication');
const { ALLOWED_TEMPLATES } = require('../config/printPermissions');
const { printDocument } = require('../controllers/print.controller');

/**
 * Middleware to authorize template permissions for the calling application
 */
const authorizeTemplate = (req, res, next) => {
    const template = req.body.template || req.query.template;
    const callingApp = req.callingApp;

    if (!template) {
        return res.status(400).json({ message: 'Template name is required' });
    }

    const allowed = ALLOWED_TEMPLATES[callingApp];
    if (!allowed) {
        console.warn(`[Print Auth] [Failure] Application '${callingApp}' has no configured permissions`);
        return res.status(403).json({ message: `Permission Denied: Application '${callingApp}' is not authorized to print any templates.` });
    }

    if (allowed.includes('*') || allowed.includes(template)) {
        return next();
    }

    console.warn(`[Print Auth] [Failure] Application '${callingApp}' is not authorized for template '${template}'`);
    return res.status(403).json({ message: `Permission Denied: Application '${callingApp}' is not authorized to print template '${template}'.` });
};

router.route('/')
    .get(printAuthentication, authorizeTemplate, printDocument)
    .post(printAuthentication, authorizeTemplate, printDocument);

module.exports = router;
