const supabase = require('../services/supabaseClient');

// ── POST /api/driver/verify — submit verification documents ───────────────────
async function submitVerification(req, res, next) {
  try {
    const { number_plate, vehicle_model, license_url, vehicle_image_url } = req.body;
    const userId = req.user.id;

    if (!number_plate?.trim() || !vehicle_model?.trim()) {
      return res.status(400).json({ error: 'Number plate and vehicle model are required' });
    }

    const { data: doc, error } = await supabase
      .from('driver_documents')
      .upsert({
        user_id:            userId,
        number_plate:       number_plate.toUpperCase().trim(),
        vehicle_model:      vehicle_model.trim(),
        license_url:        license_url   || null,
        vehicle_image_url:  vehicle_image_url || null,
        verification_status: 'pending',
        updated_at:         new Date().toISOString(),
      }, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) throw error;

    // Upgrade user role to 'both' so they can post rides immediately
    await supabase
      .from('users')
      .update({ role: 'both', updated_at: new Date().toISOString() })
      .eq('id', userId);

    res.json({
      document: doc,
      message: 'Verification submitted successfully. You can now post rides.',
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/driver/verify — get this driver's verification status ─────────────
async function getVerificationStatus(req, res, next) {
  try {
    const { data: doc, error } = await supabase
      .from('driver_documents')
      .select('*')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (error) throw error;
    res.json({ document: doc || null });
  } catch (err) {
    next(err);
  }
}

module.exports = { submitVerification, getVerificationStatus };
