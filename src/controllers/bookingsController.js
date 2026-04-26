const supabase = require('../services/supabaseClient');

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

module.exports = { myBookings, myRides, myEarnings };
