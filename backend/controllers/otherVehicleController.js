const OtherVehicle = require('../models/OtherVehicle');
const OtherVehicleTaxHistory = require('../models/OtherVehicleTaxHistory');

const getChangedByName = (req) =>
    req.user?.employee_name || req.user?.name || req.user?.username || 'Admin';

// @desc    Get all other vehicles
// @route   GET /api/other-vehicles
// @access  Private/Admin
const getOtherVehicles = async (req, res) => {
    try {
        let query = {};
        if (req.user) {
            const isSuperAdmin = req.user.roles && req.user.roles.includes('superadmin');
            if (!isSuperAdmin && req.user.campuses && req.user.campuses.length > 0) {
                if (req.query.campus) {
                    if (req.user.campuses.map(c => c.toString()).includes(req.query.campus)) {
                        query.campus = req.query.campus;
                    } else {
                        query.campus = null;
                    }
                } else {
                    query.campus = { $in: req.user.campuses };
                }
            } else if (req.query.campus) {
                query.campus = req.query.campus;
            }
        }
        const vehicles = await OtherVehicle.find(query).populate('campus');
        res.json(vehicles);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get single vehicle details
// @route   GET /api/other-vehicles/:id
// @access  Private/Admin
const getOtherVehicleById = async (req, res) => {
    try {
        const vehicle = await OtherVehicle.findById(req.params.id).populate('campus');
        if (!vehicle) {
            return res.status(404).json({ message: 'Vehicle not found' });
        }
        res.json(vehicle);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Create an other vehicle
// @route   POST /api/other-vehicles
// @access  Private/Admin
const createOtherVehicle = async (req, res) => {
    try {
        const vehicle = new OtherVehicle(req.body);
        const createdVehicle = await vehicle.save();
        res.status(201).json(createdVehicle);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Update an other vehicle
// @route   PUT /api/other-vehicles/:id
// @access  Private/Admin
const updateOtherVehicle = async (req, res) => {
    try {
        const vehicle = await OtherVehicle.findById(req.params.id);

        if (!vehicle) {
            return res.status(404).json({ message: 'Vehicle not found' });
        }

        vehicle.vehicleNumber = req.body.vehicleNumber || vehicle.vehicleNumber;
        vehicle.capacity = req.body.capacity || vehicle.capacity;
        vehicle.type = req.body.type || vehicle.type;
        vehicle.status = req.body.status || vehicle.status;
        vehicle.campus = req.body.campus !== undefined ? (req.body.campus || null) : vehicle.campus;
        vehicle.driverName = req.body.driverName !== undefined ? req.body.driverName : vehicle.driverName;
        vehicle.attendantName = req.body.attendantName !== undefined ? req.body.attendantName : vehicle.attendantName;

        if (req.body.vehicleModel !== undefined) {
            vehicle.vehicleModel = req.body.vehicleModel;
        }
        if (req.body.registrationDate !== undefined) {
            vehicle.registrationDate = req.body.registrationDate ? new Date(req.body.registrationDate) : null;
        }

        const updatedVehicle = await vehicle.save();
        res.json(updatedVehicle);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Delete an other vehicle
// @route   DELETE /api/other-vehicles/:id
// @access  Private/Admin
const deleteOtherVehicle = async (req, res) => {
    try {
        const vehicle = await OtherVehicle.findById(req.params.id);

        if (vehicle) {
            await vehicle.deleteOne();
            res.json({ message: 'Vehicle removed' });
        } else {
            res.status(404).json({ message: 'Vehicle not found' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Add a tax to an other vehicle
// @route   POST /api/other-vehicles/:id/taxes
// @access  Private/Admin
const addOtherVehicleTax = async (req, res) => {
    try {
        const vehicle = await OtherVehicle.findById(req.params.id);
        if (!vehicle) {
            return res.status(404).json({ message: 'Vehicle not found' });
        }

        const { taxHeader, amount, endDate } = req.body;

        if (!taxHeader || amount === undefined || !endDate) {
            return res.status(400).json({ message: 'Tax header, amount, and end date are required' });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const existingActiveTax = vehicle.taxes.find(tax => {
            const taxEndDate = new Date(tax.endDate);
            taxEndDate.setHours(0, 0, 0, 0);
            return tax.taxHeader.toLowerCase() === taxHeader.toLowerCase() && taxEndDate >= today;
        });

        if (existingActiveTax) {
            return res.status(400).json({ 
                message: `Tax header '${taxHeader}' is already active on this vehicle until ${new Date(existingActiveTax.endDate).toLocaleDateString()}.` 
            });
        }

        const newTax = {
            taxHeader: taxHeader.trim(),
            amount: parseFloat(amount),
            endDate: new Date(endDate),
            createdAt: new Date()
        };

        vehicle.taxes.push(newTax);
        const updatedVehicle = await vehicle.save();

        // Record history
        const endDateNorm = new Date(endDate);
        endDateNorm.setHours(0, 0, 0, 0);
        await OtherVehicleTaxHistory.create({
            vehicleId: vehicle._id,
            vehicleNumber: vehicle.vehicleNumber,
            taxHeader: taxHeader.trim(),
            action: 'added',
            amount: parseFloat(amount),
            endDate: new Date(endDate),
            previousAmount: null,
            previousEndDate: null,
            wasExpiredAtAction: endDateNorm < today,
            changedBy: getChangedByName(req),
        });

        res.status(201).json(updatedVehicle);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Update a tax for an other vehicle
// @route   PUT /api/other-vehicles/:id/taxes/:taxId
// @access  Private/Admin
const updateOtherVehicleTax = async (req, res) => {
    try {
        const vehicle = await OtherVehicle.findById(req.params.id);
        if (!vehicle) {
            return res.status(404).json({ message: 'Vehicle not found' });
        }

        const tax = vehicle.taxes.id(req.params.taxId);
        if (!tax) {
            return res.status(404).json({ message: 'Tax not found' });
        }

        const { taxHeader, amount, endDate } = req.body;

        if (taxHeader && taxHeader.toLowerCase() !== tax.taxHeader.toLowerCase()) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const existingActiveTax = vehicle.taxes.find(t => {
                if (t._id.toString() === req.params.taxId) return false;
                const taxEndDate = new Date(t.endDate);
                taxEndDate.setHours(0, 0, 0, 0);
                return t.taxHeader.toLowerCase() === taxHeader.toLowerCase() && taxEndDate >= today;
            });

            if (existingActiveTax) {
                return res.status(400).json({ 
                    message: `Tax header '${taxHeader}' is already active on this vehicle until ${new Date(existingActiveTax.endDate).toLocaleDateString()}.` 
                });
            }
        }

        const prevAmount = tax.amount;
        const prevEndDate = tax.endDate;
        const prevHeader = tax.taxHeader;

        if (taxHeader) tax.taxHeader = taxHeader.trim();
        if (amount !== undefined) tax.amount = parseFloat(amount);
        if (endDate) tax.endDate = new Date(endDate);

        const updatedVehicle = await vehicle.save();

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const newEndDate = endDate ? new Date(endDate) : prevEndDate;
        const newEndDateNorm = new Date(newEndDate);
        newEndDateNorm.setHours(0, 0, 0, 0);
        await OtherVehicleTaxHistory.create({
            vehicleId: vehicle._id,
            vehicleNumber: vehicle.vehicleNumber,
            taxHeader: (taxHeader || prevHeader).trim(),
            action: 'updated',
            amount: amount !== undefined ? parseFloat(amount) : prevAmount,
            endDate: newEndDate,
            previousAmount: prevAmount,
            previousEndDate: prevEndDate,
            wasExpiredAtAction: newEndDateNorm < today,
            changedBy: getChangedByName(req),
        });

        res.json(updatedVehicle);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Delete a tax from an other vehicle
// @route   DELETE /api/other-vehicles/:id/taxes/:taxId
// @access  Private/Admin
const deleteOtherVehicleTax = async (req, res) => {
    try {
        const vehicle = await OtherVehicle.findById(req.params.id);
        if (!vehicle) {
            return res.status(404).json({ message: 'Vehicle not found' });
        }

        const tax = vehicle.taxes.id(req.params.taxId);
        if (!tax) {
            return res.status(404).json({ message: 'Tax not found' });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const endDateNorm = new Date(tax.endDate);
        endDateNorm.setHours(0, 0, 0, 0);
        const taxSnapshot = {
            taxHeader: tax.taxHeader,
            amount: tax.amount,
            endDate: tax.endDate,
            wasExpired: endDateNorm < today,
        };

        tax.deleteOne();
        const updatedVehicle = await vehicle.save();

        await OtherVehicleTaxHistory.create({
            vehicleId: vehicle._id,
            vehicleNumber: vehicle.vehicleNumber,
            taxHeader: taxSnapshot.taxHeader,
            action: 'deleted',
            amount: taxSnapshot.amount,
            endDate: taxSnapshot.endDate,
            previousAmount: null,
            previousEndDate: null,
            wasExpiredAtAction: taxSnapshot.wasExpired,
            changedBy: getChangedByName(req),
        });

        res.json(updatedVehicle);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Get tax change history for an other vehicle
// @route   GET /api/other-vehicles/:id/taxes/history
// @access  Private/Admin
const getOtherVehicleTaxHistory = async (req, res) => {
    try {
        const vehicle = await OtherVehicle.findById(req.params.id);
        if (!vehicle) {
            return res.status(404).json({ message: 'Vehicle not found' });
        }

        let query = { vehicleId: vehicle._id };
        if (req.query.taxHeader) {
            query.taxHeader = req.query.taxHeader;
        }

        const history = await OtherVehicleTaxHistory.find(query)
            .sort({ actionAt: -1 })
            .lean();

        res.json(history);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getOtherVehicles,
    getOtherVehicleById,
    createOtherVehicle,
    updateOtherVehicle,
    deleteOtherVehicle,
    addOtherVehicleTax,
    updateOtherVehicleTax,
    deleteOtherVehicleTax,
    getOtherVehicleTaxHistory
};
