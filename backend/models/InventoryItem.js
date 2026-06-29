const mongoose = require('mongoose');

const inventoryItemSchema = new mongoose.Schema({
    itemName: {
        type: String,
        required: true,
        trim: true
    },
    variantName: {
        type: String,
        trim: true,
        default: ''
    },
    variants: [{
        name: {
            type: String,
            required: true,
            trim: true
        },
        description: {
            type: String,
            trim: true,
            default: ''
        },
        isActive: {
            type: Boolean,
            default: true
        }
    }],
    category: {
        type: String,
        required: true,
        default: 'General'
    },
    unit: {
        type: String,
        required: true,
        default: 'Pcs'
    },
    description: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

inventoryItemSchema.virtual('displayName').get(function () {
    return this.variantName ? `${this.itemName} - ${this.variantName}` : this.itemName;
});

inventoryItemSchema.set('toJSON', { virtuals: true });
inventoryItemSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);
