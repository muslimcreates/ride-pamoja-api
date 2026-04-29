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

// ── POST /api/messages/mark-read ──────────────────────────────────────────────
// Called when a user opens a chat screen. Upserts a row in message_reads
// with the current timestamp so we know how far they've read.
async function markRead(req, res, next) {
  try {
    const { booking_id } = req.body;
    const userId = req.user.id;
    if (!booking_id) return res.status(400).json({ error: 'booking_id required' });

    const { error } = await supabase
      .from('message_reads')
      .upsert(
        { user_id: userId, booking_id, last_read_at: new Date().toISOString() },
        { onConflict: 'user_id,booking_id' }
      );
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/messages/unread-count ────────────────────────────────────────────
// Returns the total number of unread messages across all of the user's bookings.
// Unread = message not sent by the user, created after their last_read_at for
// that booking (or any message if they've never opened the chat).
async function getUnreadTotal(req, res, next) {
  try {
    const userId = req.user.id;

    // Bookings where user is passenger
    const { data: paxB } = await supabase
      .from('bookings')
      .select('id')
      .eq('passenger_id', userId)
      .neq('status', 'cancelled');

    // Bookings where user is driver (via their rides)
    const { data: driverR } = await supabase
      .from('rides')
      .select('bookings(id)')
      .eq('driver_id', userId);

    const driverBookingIds = (driverR || []).flatMap(
      (r) => (r.bookings || []).map((b) => b.id)
    );

    const allBookingIds = [
      ...new Set([...(paxB || []).map((b) => b.id), ...driverBookingIds]),
    ];

    if (allBookingIds.length === 0) return res.json({ unread_count: 0 });

    // Read receipts this user has — tells us when they last read each booking
    const { data: reads } = await supabase
      .from('message_reads')
      .select('booking_id, last_read_at')
      .eq('user_id', userId)
      .in('booking_id', allBookingIds);

    const readMap = {};
    for (const r of reads || []) {
      readMap[r.booking_id] = r.last_read_at;
    }

    // All messages in those bookings that were NOT sent by this user
    const { data: msgs } = await supabase
      .from('messages')
      .select('id, booking_id, created_at')
      .in('booking_id', allBookingIds)
      .neq('sender_id', userId);

    const unreadCount = (msgs || []).filter((msg) => {
      const lastRead = readMap[msg.booking_id];
      // If never read → always unread; otherwise only count newer messages
      return !lastRead || new Date(msg.created_at) > new Date(lastRead);
    }).length;

    res.json({ unread_count: unreadCount });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMessages, sendMessage, markRead, getUnreadTotal };
