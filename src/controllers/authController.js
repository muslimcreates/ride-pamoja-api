const bcrypt   = require('bcryptjs');
const axios    = require('axios');
const supabase = require('../services/supabaseClient');
const { sendOtpSms } = require('../services/smsService');
const { generateOtp, otpExpiresAt, isOtpExpired } = require('../utils/otp');
const { signToken } = require('../utils/jwt');

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildUserResponse(user) {
  return {
    id:               user.id,
    name:             user.name,
    email:            user.email,
    phone:            user.phone,
    role:             user.role,
    avatar_url:       user.avatar_url,
    is_verified:      user.is_verified,
    profile_complete: user.profile_complete,
    auth_provider:    user.auth_provider,
  };
}

// ── POST /api/auth/register — email + password ────────────────────────────────
async function register(req, res, next) {
  try {
    const { name, email, password, role } = req.body;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: 'Full name is required' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const validRoles = ['passenger', 'driver', 'both'];
    const userRole = validRoles.includes(role) ? role : 'passenger';

    // Check if email already exists
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const { data: user, error } = await supabase
      .from('users')
      .insert({
        name:             name.trim(),
        email:            email.toLowerCase(),
        password_hash:    passwordHash,
        role:             userRole,
        auth_provider:    'email',
        profile_complete: true,
      })
      .select()
      .single();

    if (error) throw error;

    const token = signToken({ id: user.id, email: user.email, role: user.role });

    res.status(201).json({ token, isNewUser: true, user: buildUserResponse(user) });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/login — email + password ───────────────────────────────────
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (error || !user) {
      return res.status(401).json({ error: 'No account found with this email' });
    }

    if (!user.password_hash) {
      return res.status(401).json({
        error: 'This account uses Google Sign-In. Please sign in with Google.',
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    const token = signToken({ id: user.id, email: user.email, role: user.role });

    res.json({
      token,
      isNewUser: false,
      user: buildUserResponse(user),
    });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/google — verify Google ID token ────────────────────────────
async function googleAuth(req, res, next) {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ error: 'Google ID token is required' });
    }

    // Verify the token with Google
    let googleUser;
    try {
      const { data } = await axios.get(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
      );
      googleUser = data;
    } catch {
      return res.status(401).json({ error: 'Invalid Google token. Please try again.' });
    }

    const { sub: googleId, email, name, picture } = googleUser;

    if (!email) {
      return res.status(400).json({ error: 'Google account has no email address' });
    }

    // Find by google_id first, then fall back to email
    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('google_id', googleId)
      .maybeSingle();

    let isNewUser = false;

    if (!user) {
      // Try finding by email (user may have registered with email before)
      const { data: existingByEmail } = await supabase
        .from('users')
        .select('*')
        .eq('email', email.toLowerCase())
        .maybeSingle();

      if (existingByEmail) {
        // Link Google ID to existing email account
        const { data: updated } = await supabase
          .from('users')
          .update({ google_id: googleId, avatar_url: picture, auth_provider: 'google' })
          .eq('id', existingByEmail.id)
          .select()
          .single();
        user = updated;
      } else {
        // Brand new user — create account
        const { data: newUser, error: createError } = await supabase
          .from('users')
          .insert({
            name:             name || email.split('@')[0],
            email:            email.toLowerCase(),
            google_id:        googleId,
            avatar_url:       picture,
            role:             'passenger',
            auth_provider:    'google',
            profile_complete: false,
          })
          .select()
          .single();

        if (createError) throw createError;
        user = newUser;
        isNewUser = true;
      }
    }

    const token = signToken({ id: user.id, email: user.email, role: user.role });

    res.json({ token, isNewUser, user: buildUserResponse(user) });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/profile ────────────────────────────────────────────────────
async function saveProfile(req, res, next) {
  try {
    const { name, national_id, role, avatar_url } = req.body;
    const userId = req.user.id;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: 'Name must be at least 2 characters' });
    }

    const validRoles = ['passenger', 'driver', 'both'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Role must be passenger, driver, or both' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .update({
        name:             name.trim(),
        national_id,
        role,
        avatar_url,
        profile_complete: true,
        updated_at:       new Date().toISOString(),
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    const token = signToken({ id: user.id, email: user.email, role: user.role });
    res.json({ token, user: buildUserResponse(user) });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
async function getMe(req, res, next) {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, email, phone, role, avatar_url, is_verified, rating, trip_count, profile_complete, auth_provider')
      .eq('id', req.user.id)
      .single();

    if (error || !user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

// ── Legacy phone OTP (keep for backward compat) ───────────────────────────────
async function sendOtp(req, res, next) {
  try {
    const { phone } = req.body;
    if (!phone || !/^\+2547\d{8}$|^\+2541\d{8}$/.test(phone)) {
      return res.status(400).json({ error: 'Invalid Kenyan phone number' });
    }
    const code = generateOtp();
    const expiresAt = otpExpiresAt();

    const { error: dbError } = await supabase
      .from('otp_codes')
      .upsert({ phone, code, expires_at: expiresAt, verified: false }, { onConflict: 'phone' });

    if (dbError) throw dbError;

    console.log(`\n📱 OTP for ${phone}: ${code}\n`);

    try {
      await sendOtpSms(phone, code);
    } catch (smsErr) {
      console.warn(`⚠️  SMS failed: ${smsErr.message}`);
    }

    res.json({ message: 'OTP sent successfully' });
  } catch (err) {
    next(err);
  }
}

async function verifyOtp(req, res, next) {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ error: 'Phone and code are required' });

    const { data: otpRecord, error: fetchError } = await supabase
      .from('otp_codes').select('*').eq('phone', phone).single();

    if (fetchError || !otpRecord) return res.status(400).json({ error: 'No OTP found. Request a new one.' });
    if (otpRecord.verified) return res.status(400).json({ error: 'OTP already used.' });
    if (isOtpExpired(otpRecord.expires_at)) return res.status(400).json({ error: 'OTP expired.' });
    if (otpRecord.code !== code) return res.status(400).json({ error: 'Incorrect code.' });

    await supabase.from('otp_codes').update({ verified: true }).eq('phone', phone);

    let { data: user } = await supabase.from('users').select('*').eq('phone', phone).maybeSingle();
    let isNewUser = false;

    if (!user) {
      const { data: newUser, error: createError } = await supabase
        .from('users').insert({ phone, role: 'passenger', auth_provider: 'phone' }).select().single();
      if (createError) throw createError;
      user = newUser;
      isNewUser = true;
    }

    const token = signToken({ id: user.id, email: user.email, role: user.role });
    res.json({ token, isNewUser, user: buildUserResponse(user) });
  } catch (err) {
    next(err);
  }
}

// ── DELETE /api/auth/account — permanently delete the calling user's account ──
async function deleteAccount(req, res, next) {
  try {
    const userId = req.user.id;

    // 1. Find all booking IDs where this user is the passenger
    const { data: passengerBookings } = await supabase
      .from('bookings').select('id').eq('passenger_id', userId);
    const passengerBookingIds = (passengerBookings || []).map(b => b.id);

    // 2. Find all ride IDs where this user is the driver
    const { data: driverRides } = await supabase
      .from('rides').select('id').eq('driver_id', userId);
    const driverRideIds = (driverRides || []).map(r => r.id);

    // 3. Find all booking IDs on the driver's rides
    let driverBookingIds = [];
    if (driverRideIds.length > 0) {
      const { data: driverBookings } = await supabase
        .from('bookings').select('id').in('ride_id', driverRideIds);
      driverBookingIds = (driverBookings || []).map(b => b.id);
    }

    const allBookingIds = [...new Set([...passengerBookingIds, ...driverBookingIds])];

    // 4. Delete in FK-safe order: messages → ratings → payments → bookings → rides → user
    if (allBookingIds.length > 0) {
      await supabase.from('messages').delete().in('booking_id', allBookingIds);
      await supabase.from('ratings').delete().in('booking_id', allBookingIds);
      await supabase.from('payments').delete().in('booking_id', allBookingIds);
      await supabase.from('bookings').delete().in('id', allBookingIds);
    }

    // Also delete any messages sent by this user not caught above
    await supabase.from('messages').delete().eq('sender_id', userId);
    await supabase.from('ratings').delete().eq('rater_id', userId);
    await supabase.from('ratings').delete().eq('rated_id', userId);

    if (driverRideIds.length > 0) {
      await supabase.from('rides').delete().in('id', driverRideIds);
    }

    // 5. Delete the user (driver_profiles + driver_documents cascade)
    const { error } = await supabase.from('users').delete().eq('id', userId);
    if (error) throw error;

    res.json({ message: 'Account deleted successfully.' });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/auth/me — update name and/or avatar_url ───────────────────────
async function updateProfile(req, res, next) {
  try {
    const userId = req.user.id;
    const { name, avatar_url } = req.body;

    const updates = { updated_at: new Date().toISOString() };
    if (name?.trim())    updates.name       = name.trim();
    if (avatar_url)      updates.avatar_url = avatar_url;

    if (Object.keys(updates).length === 1) {
      return res.status(400).json({ error: 'Provide at least name or avatar_url to update' });
    }

    const { data: user, error } = await supabase
      .from('users').update(updates).eq('id', userId).select().single();
    if (error) throw error;

    res.json({ user: buildUserResponse(user) });
  } catch (err) { next(err); }
}

module.exports = { register, login, googleAuth, saveProfile, getMe, updateProfile, sendOtp, verifyOtp, deleteAccount };
