const supabase = require('../services/supabaseClient');

// ── GET /api/messages?booking_id=X ───────────────────────────────────────────
async function getMessages(req, res, next) {
  try {
    const { booking_id } = req.query;
    const userId = req.user.id;

    if (!booking_id) {
      return res.status(400).json({ error: 'booking_id is required' });
    }

    // Verify user is a participant in this booking
    const { data: booking } = await supabase
      .from('bookings')
      .select('passenger_id, ride:rides!ride_id(driver_id)')
      .eq('id', booking_id)
      .single();

    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const driverId = booking.ride?.driver_id;
    if (booking.passenger_id !== userId && driverId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { data: messages, error } = await supabase
      .from('messages')
      .select('id, content, sender_id, created_at, sender:users!sender_id(name, avatar_url)')
      .eq('booking_id', booking_id)
      .order('created_at', { ascending: true });

    if (error) throw error;

    res.json({ messages: messages || [] });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/messages ────────────────────────────────────────────────────────
async function sendMessage(req, res, next) {
  try {
    const { booking_id, content } = req.body;
    const userId = req.user.id;

    if (!booking_id || !content?.trim()) {
      return res.status(400).json({ error: 'booking_id and content are required' });
    }

    // Verify user is a participant
    const { data: booking } = await supabase
      .from('bookings')
      .select('passenger_id, ride:rides!ride_id(driver_id)')
      .eq('id', booking_id)
      .single();

    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const driverId = booking.ride?.driver_id;
    if (booking.passenger_id !== userId && driverId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { data: message, error } = await supabase
      .from('messages')
      .insert({ booking_id, sender_id: userId, content: content.trim() })
      .select('id, content, sender_id, created_at, sender:users!sender_id(name, avatar_url)')
      .single();

    if (error) throw error;

    res.status(201).json({ message });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMessages, sendMessage };
