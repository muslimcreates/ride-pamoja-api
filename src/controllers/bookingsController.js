const supabase = require('../services/supabaseClient');

// ── POST /api/bookings — create a cash booking (atomic / race-safe) ──────────
async function createBooking(req, res, next) {
  try {
    const { ride_id, seats = 1, notes } = req.body;
    const passengerId = req.user.id;

    if (!ride_id) return res.status(400).json({ error: 'ride_id is required' });
    const numSeats = parseInt(seats, 10);
    if (isNaN(numSeats) || numSeats < 1 || numSeats > 4) {
      return res.status(400).json({ error: 'Seats must be between 1 and 4' });
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
  } catch (err) { nex