const supabase = require('../services/supabaseClient');

// ── POST /api/bookings — create a cash booking (atomic / race-safe) ──────────
async function createBooking(req, res, next) {
  try {
    const { ride_id, seats = 1, notes } = req.body;
    const passengerId = req.user.id;

    if (!ride_id) return res.status(400).json({ error: 'ride_id is required' });
    const numSeats = parseInt(seats, 10);
    if (isNaN(numSeats) || numSeats < 1 || numSeats > 6) {
      return res.status(400).json({ error: 'Seats must be between 1 and 6' });
    }

    // 1. Read ride — get current snapshot (includes available_seats for optimistic lock)
    const { data: ride, error: rideErr } = await supabase
      .from('rides').select('*').eq('id', ride_id).single();

    if (rideErr || !ride) return res.status(404).json({ error: 'Ride not found' });
    if (ride.status !== 'active') return res.status(400).json({ error: 'This ride is no longer available' });
    if (ride.driver_id === passengerId) return res.status(400).json({ error: 'You cannot book your own ride' });
    if (ride.available_seats < numSeats) {
      return res.status(400).json({ error: `Only ${ride.available_seats} seat(s) available` });
    }

    // 2. Check for duplicate booking
    const { data: existing } = await supabase
      .from('bookings').select('id').eq('ride_id', ride_id)
      .eq('passenger_id', passengerId).neq('status', 'cancelled').maybeSingle();
    if (existing) return res.status(409).json({ error: 'You have already booked this ride' });

    // 3. Atomically decrement available_seats using optimistic lock.
    //    We only update the row if available_seats still equals the value we read.
    //    If another booking landed between steps 1 and 3, this update returns 0 rows.
    const newSeats = ride.available_seats - numSeats;
    const { data: decremented, error: decrErr } = await supabase
      .from('rides')
      .update({ available_seats: newSeats })
      .eq('id', ride_id)
      .eq('available_seats', ride.available_seats) // optimistic lock
      .eq('status', 'active')
      .gte('available_seats', numSeats)             // sanity: seats still enough
      .select('id')
      .maybeSingle();

    if (decrErr) throw decrErr;
    if (!decremented) {
      // Another concurrent request beat us — seats gone or ride changed
      return res.status(409).json({
        error: 'Seat no longer available — another booking just came in. Please try again.',
      });
    }

    // 4. Insert the booking (seats already claimed above)
    const { data: booking, error: bookErr } = await supabase
      .from('bookings')
      .insert({
        ride_id, passenger_id: passengerId,
        seats: numSeats, total_amount: ride.price_per_seat * numSeats,
        status: 'confirmed', payment_method: 'cash', payment_status: 'unpaid',
        notes: notes?.trim() || null,
      })
      .select().single();

    if (bookErr) {
      // Booking insert failed — roll back the seat decrement
      await supabase.from('rides')
        .update({ available_seats: ride.available_seats })
        .eq('id', ride_id);
      throw bookErr;
    }

    res.status(201).json({ booking });
  } catch (err) { next(err); }
}

// ── PATCH /api/bookings/:id/cancel ────────────────────────────────────────────
async function cancelBooking(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { data: booking, error: fetchErr } = await supabase
      .from('bookings').select('*, ride:rides!ride_id(id, available_seats, status)')
      .eq('id', id).single();

    if (fetchErr || !booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.passenger_id !== userId) return res.status(403).json({ error: 'Not your booking' });
    if (booking.status === 'cancelled') return res.status(400).json({ error: 'Already cancelled' });
    if (booking.status === 'completed') return res.status(400).json({ error: 'Cannot cancel a completed booking' });

    const { data: updated, error: updateErr } = await supabase
      .from('bookings').update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id).select().single();
    if (updateErr) throw updateErr;

    if (booking.ride?.status === 'active') {
      await supabase.from('rides')
        .update({ available_seats: (booking.ride.available_seats || 0) + booking.seats })
        .eq('id', booking.ride_id);
    }
    res.json({ booking: updated });
  } catch (err) { next(err); }
}

// ── GET /api/bookings/:id ─────────────────────────────────────────────────────
async function getBooking(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { data: booking, error } = await supabase
      .from('bookings')
      .select(`*, ride:rides!ride_id(
          id, origin_name, destination_name, departure_time, price_per_seat, status,
          driver:users!driver_id(id, name, rating, avatar_url, phone)
        ), passenger:users!passenger_id(id, name, avatar_url, phone)`)
      .eq('id', id).single();

    if (error || !booking) return res.status(404).json({ error: 'Booking not found' });

    const driverId = booking.ride?.driver?.id;
    if (booking.passenger_id !== userId && driverId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json({ booking });
  } catch (err) { next(err); }
}

// ── GET /api/bookings/my/conversations — inbox for chat tab ───────────────────
async function myConversations(req, res, next) {
  try {
    const userId = req.user.id;

    const { data: pax } = await supabase
      .from('bookings')
      .select(`id, status, created_at, ride:rides!ride_id(
          id, origin_name, destination_name, departure_time,
          driver:users!driver_id(id, name, avatar_url))`)
      .eq('passenger_id', userId).neq('status', 'cancelled')
      .order('created_at', { ascending: false });

    const { data: driverRides } = await supabase
      .from('rides')
      .select(`id, origin_name, destination_name, departure_time,
        bookings:bookings(id, status, created_at,
          passenger:users!passenger_id(id, name, avatar_url))`)
      .eq('driver_id', userId).neq('status', 'cancelled');

    const driverConvos = [];
    for (const ride of driverRides || []) {
      for (const b of (ride.bookings || [])) {
        if (b.status !== 'cancelled') {
          driverConvos.push({
            id: b.id, status: b.status, created_at: b.created_at,
            role: 'driver', other_user: b.passenger,
            ride: { id: ride.id, origin_name: ride.origin_name,
                    destination_name: ride.destination_name, departure_time: ride.departure_time },
          });
        }
      }
    }

    const conversations = [
      ...(pax || []).map((b) => ({ ...b, role: 'passenger', other_user: b.ride?.driver })),
      ...driverConvos,
    ].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    res.json({ conversations });
  } catch (err) { next(err); }
}

// ── GET /api/bookings/my — passenger's bookings ───────────────────────────────
async function myBookings(req, res, next) {
  try {
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select(`
        *,
        ride:rides!ride_id(
          id, origin_name, destination_name, departure_time,
          price_per_seat, status,
          driver:users!driver_id(id, name, rating, avatar_url)
        )
      `)
      .eq('passenger_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ bookings: bookings || [] });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/bookings/my/driver — rides posted by this driver ─────────────────
async function myRides(req, res, next) {
  try {
    const { data: rides, error } = await supabase
      .from('rides')
      .select(`
        *,
        bookings:bookings(id, seats, total_amount, status, passenger:users!passenger_id(id, name, avatar_url))
      `)
      .eq('driver_id', req.user.id)
      .order('departure_time', { ascending: false });

    if (error) throw error;
    res.json({ rides: rides || [] });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/bookings/my/earnings — driver earnings summary ───────────────────
async function myEarnings(req, res, next) {
  try {
    // Get all rides by this driver with their confirmed/paid bookings
    const { data: rides, error } = await supabase
      .from('rides')
      .select(`
        id, origin_name, destination_name, departure_time, status,
        bookings:bookings(id, total_amount, status, seats)
      `)
      .eq('driver_id', req.user.id)
      .order('departure_time', { ascending: false });

    if (error) throw error;

    // Calculate earnings from confirmed/paid/completed bookings
    let totalEarned = 0;
    let thisMonthEarned = 0;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const earningsByRide = (rides || []).map((ride) => {
      const paidBookings = (ride.bookings || []).filter(
        (b) => ['confirmed', 'paid', 'completed'].includes(b.status)
      );
      const rideTotal = paidBookings.reduce((sum, b) => sum + b.total_amount, 0);
      totalEarned += rideTotal;

      const depDate = new Date(ride.departure_time);
      if (depDate >= startOfMonth) {
        thisMonthEarned += rideTotal;
      }

      return {
        ride_id:          ride.id,
        origin_name:      ride.origin_name,
        destination_name: ride.destination_name,
        departure_time:   ride.departure_time,
        ride_status:      ride.status,
        bookings_count:   paidBookings.length,
        total_earned:     rideTotal,
      };
    }).filter((r) => r.total_earned > 0 || r.bookings_count > 0);

    res.json({
      total_earned:      totalEarned,
      this_month_earned: thisMonthEarned,
      rides:             earningsByRide,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { createBooking, cancelBooking, getBooking, myConversations, myBookings, myRides, myEarnings };
