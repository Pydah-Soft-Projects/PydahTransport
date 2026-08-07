const mongoose = require('mongoose');
const dotenv = require('dotenv');
const readline = require('readline');
const Admin = require('../models/Admin');
const { connectDB } = require('../config/db');

dotenv.config();

connectDB();

// Helper function to ask for user confirmation
const askQuestion = (query) => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => {
        rl.question(query, (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
        });
    });
};

const importData = async () => {
    try {
        // Admin Seeding
        const adminExists = await Admin.findOne({ username: 'superadmin' });
        if (adminExists) {
            const shouldOverwrite = await askQuestion(
                '⚠️  Superadmin already exists. Do you want to overwrite it? (yes/no): '
            );
            
            if (shouldOverwrite) {
                await Admin.deleteOne({ username: 'superadmin' });
                console.log('✓ Old superadmin deleted');
            } else {
                console.log('✓ Superadmin not changed.');
            }
        }

        // Create/recreate superadmin if it doesn't exist or was deleted
        const adminStillExists = await Admin.findOne({ username: 'superadmin' });
        if (!adminStillExists) {
            const admin = new Admin({
                username: 'superadmin',
                password: 'superadmin123',
                name: 'Super Admin',
                email: 'durgaprasadkakileti@gmail.com',
                phone: '+91-XXXXXXXXXX'
            });
            await admin.save();
            console.log('✓ Superadmin Created!');
        }

        process.exit();
    } catch (error) {
        console.error(`${error}`);
        process.exit(1);
    }
};

if (process.argv[2] === '-d') {
    // destroyData(); // Implement if needed separately
} else {
    importData();
}
