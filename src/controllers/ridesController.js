const supabase = require('../services/supabaseClient');

// ── POST /api/rides ───────────────────────────────────────────────────────────
async function createRide(req, res, next) {
  try {
    const {
      origin_name,
      destination_name,
      departure_time,
      price_per_seat,
      total_seats,
      notes,
    } = req.body;

    if (!origin_name || !destination_name) {
      return res.status(400).json({ error: 'Origin and destination are required' });
    }
    if (!departure_time) {
      return res.status(400).json({ error: 'Departure time is required' });
    }
    const depTime = new Date(departure_time);
    if (isNaN(depTime.getTime())) {
      return res.status(400).json({ error: 'Invalid departure time format' });
    }
    if (!price_per_seat || Number(price_per_seat) < 1) {
      return res.status(400).json({ error: 'Price per seat must be at least KES 1' });
    }
    if (!total_seats || Number(total_seats) < 1 || Number(total_seats) > 8) {
      return res.status(400).json({ error: 'Seats must be between 1 and 8' });
    }

    const { data: ride, error } = await supabase
      .from('rides')
      .insert({
        driver_id:        req.user.id,
        origin_name:      origin_name.trim(),
        destination_name: destination_name.trim(),
        departure_time:   depTime.toISOString(),
        price_per_seat:   parseInt(price_per_seat, 10),
        total_seats:      parseInt(total_seats, 10),
        available_seats:  parseInt(total_seats, 10),
        status:           'active',
        notes:            notes?.trim() || null,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ ride });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/rides/search?from=&to=&date= ─────────────────────────────────────
async function searchRides(req, res, next) {
  try {
    const { from, to, date } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: '"from" and "to" query params are required' });
    }

    let query = supabase
      .from('rides')
      .select(`
        *,
        driver:users!driver_id(id, name, rating, trip_count, avatar_url)
      `)
      .ilike('origin_name', `%${from}%`)
      .ilike('destination_name', `%${to}%`)
      .eq('status', 'active')
      .gt('available_seats', 0)
      .order('departure_time', { ascending: true });

    // Filter by departure date if provided
    if (date) {
      const d = new Date(date);
      if (!isNaN(d.getTime())) {
        const start = new Date(d);
        start.setHours(0, 0, 0, 0);
        const end = new Date(d);
        end.setHours(23, 59, 59, 999);
        query = query
          .gte('departure_time', start.toISOString())
          .lte('departure_time', end.toISOString());
      }
    }

    const { data: rides, error } = await query;
    if (error) throw error;

    res.json({ rides: rides || [] });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/rides/:id ────────────────────────────────────────────────────────
async function getRide(req, res, next) {
  try {
    const { id } = req.params;

    const { data: ride, error } = await supabase
      .from('rides')
      .select(`
        *,
        driver:users!driver_id(
          id, name, rating, trip_count, avatar_url, phone,
          driver_docs:driver_documents!user_id(vehicle_model, number_plate, vehicle_color)
        )
      `)
      .eq('id', id)
      .single();

    if (error || !ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    // Flatten driver_docs into driver for easy client access
    if (ride.driver && Array.isArray(ride.driver.driver_docs)) {
      const doc = ride.driver.driver_docs[0] ?? null;
      ride.driver = {
        ...ride.driver,
        vehicle_model:  doc?.vehicle_model  ?? null,
        number_plate:   doc?.number_plate   ?? null,
        vehicle_color:  doc?.vehicle_color  ?? null,
        driver_docs:    undefined,
      };
    }

    // Count confirmed bookings for this ride
    const { count } = await supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('ride_id', id)
      .eq('status', 'confirmed');

    res.json({ ride, bookingCount: count || 0 });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/rides/:id ──────────────────────────────────────────────────────
async function updateRide(req, res, next) {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    // Verify ownership
    const { data: existing, error: fetchError } = await supabase
      .from('rides')
      .select('driver_id, status')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({ error: 'Ride not found' });
    }
    if (existing.driver_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only edit your own rides' });
    }
    if (existing.status === 'completed') {
      return res.status(400).json({ error: 'Cannot edit a completed ride' });
    }

    const updates = {};
    if (status) {
      const allowed = ['active', 'cancelled'];
      if (!allowed.includes(status)) {
        return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });
      }
      updates.status = status;
    }
    if (notes !== undefined) updates.notes = notes?.trim() || null;

    const { data: ride, error } = await supabase
      .from('rides')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({ ride });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/rides/upcoming — active rides departing in the future ─────────────
async function getUpcomingRides(req, res, next) {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 8, 20);

    // Get active rides departing from now onwards, with driver + their vehicle docs
    const { data: rides, error } = await supabase
      .from('rides')
      .select(`
        id, origin_name, destination_name, departure_time,
        price_per_seat, available_seats, total_seats, driver_id,
        driver:users!driver_id(
          id, name, avatar_url, rating,
          driver_docs:driver_documents!user_id(vehicle_model, number_plate)
        )
      `)
      .eq('status', 'active')
      .gt('available_seats', 0)
      .gte('departure_time', new Date().toISOString())
      .order('departure_time', { ascending: true })
      .limit(limit);

    if (error) throw error;

    // For each ride, fetch confirmed passengers (name + photo only)
    const enriched = await Promise.all(
      (rides || []).map(async (ride) => {
        const { data: bookings } = await supabase
          .from('bookings')
          .select('passenger:users!passenger_id(name, avatar_url)')
          .eq('ride_id', ride.id)
          .eq('status', 'confirmed')
          .limit(4);

        // Flatten driver_docs into the driver object for easy client-side access
        const driverRaw = ride.driver;
        const driverDoc = driverRaw?.driver_docs?.[0] ?? null;
        const driver = driverRaw
          ? {
              id:            driverRaw.id,
              name:          driverRaw.name,
              avatar_url:    driverRaw.avatar_url,
              rating:        driverRaw.rating,
              vehicle_model: driverDoc?.vehicle_model ?? null,
              number_plate:  driverDoc?.number_plate  ?? null,
            }
          : null;

        return {
          ...ride,
          driver,
          passengers: (bookings || []).map((b) => ({
            name:      b.passenger?.name      ?? 'Passenger',
            photo_url: b.passenger?.avatar_url ?? null,
          })),
        };
      })
    );

    res.json({ rides: enriched });
  } catch (err) {
    next(err);
  }
}

module.exports = { createRide, searchRides, getRide, updateRide, getUpcomingRides };
