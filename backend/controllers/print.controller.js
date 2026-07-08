const printService = require('../services/print.service');

/**
 * Handle print template request, coordinates fetching, SSR rendering, and outputs HTML
 */
const printDocument = async (req, res) => {
    const template = req.body.template || req.query.template;
    const data = req.body.data || { ...req.query };
    delete data.template; // Remove template from data package to prevent pollute
    
    const timestamp = new Date().toISOString();
    const callingApp = req.callingApp || 'unknown';
    const loggedInUser = req.loggedInUser || 'none';
    const requestedRecord = JSON.stringify(data || {});

    try {
        if (!template) {
            console.warn(`[Print API] [${timestamp}] [Failure] [App: ${callingApp}] [User: ${loggedInUser}] [Template: missing] [Record: ${requestedRecord}] - Template name is missing`);
            return res.status(400).json({ message: 'Template name is required' });
        }

        if (!data || Object.keys(data).length === 0) {
            console.warn(`[Print API] [${timestamp}] [Failure] [App: ${callingApp}] [User: ${loggedInUser}] [Template: ${template}] [Record: missing] - Data payload is missing`);
            return res.status(400).json({ message: 'Data payload is required' });
        }

        const { html, title } = await printService.renderTemplate(template, data);

        // Success Log
        console.log(`[Print API] [${timestamp}] [Success] [App: ${callingApp}] [User: ${loggedInUser}] [Template: ${template}] [Record: ${requestedRecord}]`);

        // Set Headers and Send Document
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Disposition', `inline; filename="${title.replace(/[^a-zA-Z0-9-_]/g, '_')}.html"`);
        return res.status(200).send(html);
    } catch (error) {
        const statusCode = error.statusCode || 500;
        
        // Failure Log
        console.error(`[Print API] [${timestamp}] [Failure] [App: ${callingApp}] [User: ${loggedInUser}] [Template: ${template || 'unknown'}] [Record: ${requestedRecord}] - Status ${statusCode} - Error: ${error.message}`);
        
        return res.status(statusCode).json({ 
            message: error.message || 'An unexpected error occurred during print document generation' 
        });
    }
};

module.exports = {
    printDocument
};
