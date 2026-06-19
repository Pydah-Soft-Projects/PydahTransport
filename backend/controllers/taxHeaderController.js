const TaxHeader = require('../models/TaxHeader');

// @desc    Get all tax headers
// @route   GET /api/tax-headers
// @access  Private/Admin
const getTaxHeaders = async (req, res) => {
    try {
        const taxHeaders = await TaxHeader.find().sort({ createdAt: -1 });
        res.json(taxHeaders);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Create a new tax header
// @route   POST /api/tax-headers
// @access  Private/Admin
const createTaxHeader = async (req, res) => {
    try {
        const { taxName, description, defaultAmount, isActive } = req.body;

        if (!taxName || !taxName.trim()) {
            return res.status(400).json({ message: 'Tax name is required' });
        }

        const existingTaxHeader = await TaxHeader.findOne({ 
            taxName: { $regex: `^${taxName.trim()}$`, $options: 'i' } 
        });

        if (existingTaxHeader) {
            return res.status(400).json({ message: 'Tax header with this name already exists' });
        }

        const newTaxHeader = new TaxHeader({
            taxName: taxName.trim(),
            description: description?.trim() || '',
            defaultAmount: defaultAmount ? parseFloat(defaultAmount) : 0,
            isActive: isActive !== undefined ? isActive : true
        });

        const savedTaxHeader = await newTaxHeader.save();

        res.status(201).json(savedTaxHeader);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Update a tax header
// @route   PUT /api/tax-headers/:id
// @access  Private/Admin
const updateTaxHeader = async (req, res) => {
    try {
        const taxHeader = await TaxHeader.findById(req.params.id);

        if (!taxHeader) {
            return res.status(404).json({ message: 'Tax header not found' });
        }

        const { taxName, description, defaultAmount, isActive } = req.body;

        if (taxName && taxName.trim() && taxName.trim() !== taxHeader.taxName) {
            const existingTaxHeader = await TaxHeader.findOne({ 
                taxName: { $regex: `^${taxName.trim()}$`, $options: 'i' },
                _id: { $ne: req.params.id }
            });

            if (existingTaxHeader) {
                return res.status(400).json({ message: 'Tax header with this name already exists' });
            }

            taxHeader.taxName = taxName.trim();
        }

        if (description !== undefined) {
            taxHeader.description = description?.trim() || '';
        }

        if (defaultAmount !== undefined) {
            taxHeader.defaultAmount = parseFloat(defaultAmount);
        }

        if (isActive !== undefined) {
            taxHeader.isActive = isActive;
        }

        const updatedTaxHeader = await taxHeader.save();
        res.json(updatedTaxHeader);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Delete a tax header
// @route   DELETE /api/tax-headers/:id
// @access  Private/Admin
const deleteTaxHeader = async (req, res) => {
    try {
        const taxHeader = await TaxHeader.findByIdAndDelete(req.params.id);

        if (!taxHeader) {
            return res.status(404).json({ message: 'Tax header not found' });
        }

        res.json({ message: 'Tax header deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getTaxHeaders,
    createTaxHeader,
    updateTaxHeader,
    deleteTaxHeader
};
