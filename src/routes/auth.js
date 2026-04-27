const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const {
  register, login, googleAuth,
  sendOtp, verifyOtp,        // legacy phone OTP — kept for backward compat
  saveProfile, getMe,
} = require('../controllers/authController');

const router = express.Router();

// Rate limiter for email/password + Google auth (relaxed — 20 per 15 min)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many attempts. Please wait 15 minutes and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict rate limiter for legacy OTP endpoints — 5 attempts per 15 minutes per IP
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many OTP requests. Please wait 15 minutes and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── New auth routes ───────────────────────────────────────────────────────
router.post('/register', authLimiter, register);
router.post('/login',    authLimiter, login);
router.post('/google',   authLimiter, googleAuth);

// ── Legacy phone OTP ──────────────────────────────────────────────────────
router.post('/send-otp',   otpLimiter, sendOtp);
router.post('/verify-otp', otpLimiter, verifyOtp);

// ── Protected routes (require valid JWT) ──────────────────────────────────
router.post('/profile', requireAuth, saveProfile);
router.get('/me',       requireAuth, getMe);

module.exports = router;
