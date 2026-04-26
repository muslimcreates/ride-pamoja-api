const supabase = require('../services/supabaseClient');
const { sendOtpSms } = require('../services/smsService');
const { generateOtp, otpExpiresAt, isOtpExpired } = require('../utils/otp');
const { signToken } = require('../utils/jwt');

// ── POST /api/auth/send-otp ───────────────────────────────────────────────────
async function sendOtp(req, res, next) {
  try {
    const { phone } = req.body;

    if (!phone || !/^\+2547\d{8}$|^\+2541\d{8}$/.test(phone)) {
      return res.status(400).json({ error: 'Invalid Kenyan phone number. Use format +254XXXXXXXXX' });
    }

    const code = generateOtp();
    const expiresAt = otpExpiresAt();

    // Upsert OTP record — one active OTP per phone at a time
    const { error: dbError } = await supabase
      .from('otp_codes')
      .upsert(
        { phone, code, expires_at: expiresAt, verified: false },
        { onConflict: 'phone' }
      );

    if (dbError) throw dbError;

    // Always log the OTP code (visible in Railway deploy logs)
    console.log(`\n📱 OTP for ${phone}: ${code}\n`);

    // Send SMS — non-fatal in development so a bad AT key doesn't block testing
    try {
      await sendOtpSms(phone, code);
    } catch (smsErr) {
      if (process.env.NODE_ENV === 'production') throw smsErr; // fatal in prod
      console.warn(`⚠️  SMS send failed (dev mode — use the code above): ${smsErr.message}`);
    }

    res.json({ message: 'OTP sent successfully' });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/verify-otp ─────────────────────────────────────────────────
async function verifyOtp(req, res, next) {
  try {
    const { phone, code } = req.body;

    if (!phone || !code) {
      return res.status(400).json({ error: 'Phone and code are required' });
    }

    // Fetch the OTP record
    const { data: otpRecord, error: fetchError } = await supabase
      .from('otp_codes')
      .select('*')
      .eq('phone', phone)
      .single();

    if (fetchError || !otpRecord) {
      return res.status(400).json({ error: 'No OTP found for this number. Please request a new one.' });
    }

    if (otpRecord.verified) {
      return res.status(400).json({ error: 'OTP already used. Please request a new one.' });
    }

    if (isOtpExpired(otpRecord.expires_at)) {
      return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
    }

    if (otpRecord.code !== code) {
      return res.status(400).json({ error: 'Incorrect code. Please try again.' });
    }

    // Mark as verified
    await supabase
      .from('otp_codes')
      .update({ verified: true })
      .eq('phone', phone);

    // Find or create user
    let { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('phone', phone)
      .single();

    let isNewUser = false;

    if (userError || !user) {
      // New user — create a minimal record
      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert({ phone, role: 'passenger' })
        .select()
        .single();

      if (createError) throw createError;
      user = newUser;
      isNewUser = true;
    }

    // Issue JWT
    const token = signToken({
      id: user.id,
      phone: user.phone,
      role: user.role,
    });

    res.json({
      token,
      isNewUser,
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        role: user.role,
        avatar_url: user.avatar_url,
        is_verified: user.is_verified,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/profile ────────────────────────────────────────────────────
async function saveProfile(req, res, next) {
  try {
    const { name, national_id, role, avatar_url } = req.body;
    const userId = req.user.id;

    if (!name || name.trim().length < 3) {
      return res.status(400).json({ error: 'Name must be at least 3 characters' });
    }

    const validRoles = ['passenger', 'driver', 'both'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Role must be passenger, driver, or both' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .update({
        name: name.trim(),
        national_id,
        role,
        avatar_url,
        profile_complete: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    // Re-issue JWT with updated role
    const token = signToken({
      id: user.id,
      phone: user.phone,
      role: user.role,
    });

    res.json({
      token,
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        role: user.role,
        avatar_url: user.avatar_url,
        is_verified: user.is_verified,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
async function getMe(req, res, next) {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, phone, name, role, avatar_url, is_verified, rating, trip_count, profile_complete')
      .eq('id', req.user.id)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (err) {
    next(err);
  }
}

module.exports = { sendOtp, verifyOtp, saveProfile, getMe };
