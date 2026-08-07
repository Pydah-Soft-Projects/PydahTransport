const express = require('express');
const router = express.Router();
const { loginUser, ssoLogin, forgotPasswordAdmin, resetPasswordAdmin } = require('../controllers/authController');

router.post('/login', loginUser);
router.post('/sso-session', ssoLogin);
router.post('/forgot-password-admin', forgotPasswordAdmin);
router.post('/reset-password-admin', resetPasswordAdmin);

module.exports = router;
