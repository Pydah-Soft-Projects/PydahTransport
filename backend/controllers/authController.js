const Admin = require('../models/Admin');
const { getEmployeeModel } = require('../models/Employee');
const { getEmployeeConnection } = require('../config/db'); // Direct connection for 'users' collection
const UserRole = require('../models/UserRole');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const sendEmail = require('../services/emailService');

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: '30d'
    });
};

// @desc    Auth user (Admin or Employee) & get token
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res) => {
    const { username, password } = req.body;

    try {
        // 1. Try Admin (legacy)
        const admin = await Admin.findOne({ username });

        if (admin && (await admin.matchPassword(password))) {
            return res.json({
                _id: admin._id,
                username: admin.username,
                role: 'admin',
                token: generateToken(admin._id)
            });
        }

        // 2. Try Employee (HRMS employees collection)
        const Employee = getEmployeeModel();
        if (Employee) {
            const employee = await Employee.findOne({ emp_no: username });

            if (employee) {
                const isMatch = await bcrypt.compare(password, employee.password);

                if (isMatch) {
                    // Fetch roles from Local DB
                    // We need to find the user role by the employee's ID from the HRMS DB
                    const userRole = await UserRole.findOne({ employeeId: employee._id });

                    return res.json({
                        _id: employee._id,
                        username: employee.emp_no,
                        name: employee.employee_name,
                        roles: userRole ? userRole.roles : ['user'],
                        permissions: userRole ? userRole.permissions : [],
                        campuses: userRole ? userRole.campuses : [],
                        colleges: userRole ? userRole.colleges : [],
                        courses: userRole ? userRole.courses : [],
                        token: generateToken(employee._id)
                    });
                }
            }
        }

        // 3. Try User (HRMS users collection)
        const employeeConn = getEmployeeConnection();
        if (employeeConn) {
            const usersCollection = employeeConn.collection('users');
            
            // Query by email, employeeId, or simply checking if the username matches the name/email prefixes
            const user = await usersCollection.findOne({
                $or: [
                    { email: username },
                    { employeeId: username },
                    { emp_no: username }
                ],
                isActive: true
            });

            if (user) {
                const isMatch = await bcrypt.compare(password, user.password);

                if (isMatch) {
                    // The core fix: Look up the Local UserRole based on the Employee Reference pointer!
                    const userRole = await UserRole.findOne({ employeeId: user.employeeRef });

                    // Optional: Update last login natively
                    await usersCollection.updateOne({ _id: user._id }, { $set: { lastLogin: new Date() } });

                    return res.json({
                        // Return the employeeRef so the frontend system treats them identically to an 'Employee' login
                        _id: user.employeeRef, 
                        username: user.email,
                        name: user.name,
                        roles: userRole ? userRole.roles : ['user'],
                        permissions: userRole ? userRole.permissions : [],
                        campuses: userRole ? userRole.campuses : [],
                        colleges: userRole ? userRole.colleges : [],
                        courses: userRole ? userRole.courses : [],
                        token: generateToken(user.employeeRef)
                    });
                }
            }
        }

        res.status(401).json({ message: 'Invalid username or password' });
    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    SSO Token Verification & Login
// @route   POST /api/auth/sso-session
// @access  Public
const ssoLogin = async (req, res) => {
    const { ssoToken } = req.body;

    if (!ssoToken) {
        return res.status(400).json({ message: 'SSO token is required' });
    }

    try {
        // 1. Verify token with CRM Backend
        const crmVerifyUrl = `${process.env.CRM_BACKEND_URL || 'http://localhost:8000'}/auth/verify-token`;
        const verifyResponse = await fetch(crmVerifyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ encryptedToken: ssoToken })
        });

        const verifyResult = await verifyResponse.json();

        if (!verifyResult.success || !verifyResult.valid) {
            return res.status(401).json({ message: verifyResult.message || 'Invalid SSO token' });
        }

        // Extract data from CRM response
        const { userId: crmUserId, role: crmRole } = verifyResult.data;

        // 2. Token is valid. Find user in our system.
        // We use the userId returned by CRM.
        
        // Try Employee (HRMS employees collection)
        const Employee = getEmployeeModel();
        let userPayload = null;

        if (Employee) {
            // First try by ID
            let employee = await Employee.findById(crmUserId);
            
            // If not found by ID, try by emp_no
            if (!employee) {
                employee = await Employee.findOne({ emp_no: crmUserId });
            }

            if (employee) {
                const userRole = await UserRole.findOne({ employeeId: employee._id });
                userPayload = {
                    _id: employee._id,
                    username: employee.emp_no,
                    name: employee.employee_name,
                    roles: userRole ? userRole.roles : ['user'],
                    permissions: userRole ? userRole.permissions : [],
                    campuses: userRole ? userRole.campuses : [],
                    colleges: userRole ? userRole.colleges : [],
                    courses: userRole ? userRole.courses : [],
                    isSSO: true,
                    token: generateToken(employee._id)
                };
            }
        }

        // 3. If not found in Employee DB, try Legacy Admin DB
        if (!userPayload) {
            const admin = await Admin.findById(crmUserId);
            if (admin) {
                userPayload = {
                    _id: admin._id,
                    username: admin.username,
                    role: 'admin',
                    isSSO: true,
                    token: generateToken(admin._id)
                };
            }
        }

        if (userPayload) {
            return res.json(userPayload);
        }

        res.status(404).json({ message: 'User not found in Transport system' });
    } catch (error) {
        console.error('SSO Login Error:', error);
        res.status(500).json({ message: 'Internal server error during SSO verification' });
    }
};

// @desc    Forgot Password for Superadmin
// @route   POST /api/auth/forgot-password-admin
// @access  Public
const forgotPasswordAdmin = async (req, res) => {
    const { email } = req.body;

    try {
        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        // Find admin by email
        const admin = await Admin.findOne({ email });

        if (!admin) {
            return res.status(404).json({ message: 'Superadmin with this email not found' });
        }

        // Generate 6-digit random password (numbers only)
        const newPassword = Math.floor(100000 + Math.random() * 900000).toString();

        // Update admin document with new password (it will be hashed by the pre-save middleware)
        admin.password = newPassword;
        await admin.save();

        // Prepare email
        const emailOptions = {
            email: admin.email,
            subject: 'Your Temporary Password - Transport System',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2>Password Reset Request</h2>
                    <p>Hello <strong>${admin.name}</strong>,</p>
                    <p>Your temporary password has been generated:</p>
                    <div style="background-color: #f0f0f0; padding: 15px; margin: 20px 0; border-left: 4px solid #007bff;">
                        <p style="font-size: 18px; font-weight: bold; color: #333; margin: 0;">
                            ${newPassword}
                        </p>
                    </div>
                    <p>Please use this password to login to the Transport System.</p>
                    <p><strong>Security Tip:</strong> Change this password after your first login.</p>
                    <p>If you did not request a password reset, please contact your administrator.</p>
                    <hr style="border: none; border-top: 1px solid #ddd; margin-top: 30px;">
                    <p style="font-size: 12px; color: #666;">This is an automated message. Please do not reply to this email.</p>
                </div>
            `
        };

        // Send email
        await sendEmail(emailOptions);

        res.json({ 
            message: 'Password reset email sent successfully',
            email: email
        });
    } catch (error) {
        console.error('Forgot Password Error:', error);
        res.status(500).json({ message: error.message || 'Failed to process forgot password request' });
    }
};

// @desc    Reset Password for Superadmin (if needed for manual reset)
// @route   POST /api/auth/reset-password-admin
// @access  Private (requires admin token)
const resetPasswordAdmin = async (req, res) => {
    const { adminId, newPassword } = req.body;

    try {
        if (!adminId || !newPassword) {
            return res.status(400).json({ message: 'Admin ID and new password are required' });
        }

        const admin = await Admin.findById(adminId);

        if (!admin) {
            return res.status(404).json({ message: 'Admin not found' });
        }

        admin.password = newPassword;
        await admin.save();

        res.json({ message: 'Password updated successfully' });
    } catch (error) {
        console.error('Reset Password Error:', error);
        res.status(500).json({ message: error.message || 'Failed to reset password' });
    }
};

module.exports = { loginUser, ssoLogin, forgotPasswordAdmin, resetPasswordAdmin };