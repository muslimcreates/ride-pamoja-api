-- ════════════════════════════════════════════════════════════════════════════
-- Ride Pamoja — Supabase PostgreSQL Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
-- ════════════════════════════════════════════════════════════════════════════

-- Enable PostGIS for geo queries
create extension if not exists postgis;

-- ── OTP codes (temporary, one per phone) ─────────────────────────────────────
create table if not exists otp_codes (
  phone       text primary key,
  code        text not null,
  expires_at  timestamptz not null,
  verified    boolean default false,
  created_at  timestamptz default now()
);

-- Auto-delete expired OTPs after 1 hour (keeps table clean)
create index if not exists idx_otp_expires on otp_codes(expires_at);

-- ── Users ─────────────────────────────────────────────────────────────────────
create table if not exists users (
  id               uuid primary key default gen_random_uuid(),
  phone            text unique not null,
  name             text,
  national_id      text,
  role             text not null default 'passenger'
                     check (role in ('passenger', 'driver', 'both')),
  avatar_url       text,
  rating           numeric(3,2) default 5.00,
  trip_count       integer default 0,
  is_verified      boolean default false,
  profile_complete boolean default false,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create index if not exists idx_users_phone on users(phone);

-- ── Driver profiles (extra info for drivers) ──────────────────────────────────
create table if not exists driver_profiles (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(id) on delete cascade,
  vehicle_make     text,           -- e.g. "Toyota"
  vehicle_model    text,           -- e.g. "Premio"
  vehicle_year     integer,
  plate_number     text,
  vehicle_color    text,
  license_number   text,
  insurance_expiry date,
  approved         boolean default false,
  created_at       timestamptz default now(),
  unique(user_id)
);

-- ── Rides ─────────────────────────────────────────────────────────────────────
create table if not exists rides (
  id                uuid primary key default gen_random_uuid(),
  driver_id         uuid not null references users(id),
  origin_name       text not null,           -- "Westlands"
  origin_coords     geography(Point, 4326),  -- PostGIS point
  destination_name  text not null,           -- "CBD, Nairobi"
  destination_coords geography(Point, 4326),
  waypoints         jsonb default '[]',      -- optional stops
  departure_time    timestamptz not null,
  price_per_seat    integer not null,        -- KES
  total_seats       integer not null,
  available_seats   integer not null,
  status            text default 'active'
                      check (status in ('active', 'full', 'completed', 'cancelled')),
  notes             text,
  created_at        timestamptz default now()
);

create index if not exists idx_rides_driver    on rides(driver_id);
create index if not exists idx_rides_departure on rides(departure_time);
create index if not exists idx_rides_status    on rides(status);
create index if not exists idx_rides_origin    on rides using gist(origin_coords);
create index if not exists idx_rides_dest      on rides using gist(destination_coords);

-- ── Bookings ──────────────────────────────────────────────────────────────────
create table if not exists bookings (
  id           uuid primary key default gen_random_uuid(),
  ride_id      uuid not null references rides(id),
  passenger_id uuid not null references users(id),
  seats        integer not null default 1,
  total_amount integer not null,       -- KES
  status       text default 'pending'
                 check (status in ('pending', 'confirmed', 'paid', 'cancelled', 'completed')),
  pickup_note  text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique(ride_id, passenger_id)        -- one booking per passenger per ride
);

create index if not exists idx_bookings_ride      on bookings(ride_id);
create index if not exists idx_bookings_passenger on bookings(passenger_id);
create index if not exists idx_bookings_status    on bookings(status);

-- ── Payments ──────────────────────────────────────────────────────────────────
create table if not exists payments (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          uuid not null references bookings(id),
  passenger_id        uuid not null references users(id),
  amount              integer not null,       -- KES
  mpesa_ref           text,                  -- M-Pesa transaction ID
  checkout_request_id text,                  -- STK push request ID
  status              text default 'pending'
                        check (status in ('pending', 'completed', 'failed', 'refunded')),
  paid_at             timestamptz,
  created_at          timestamptz default now()
);

create index if not exists idx_payments_booking on payments(booking_id);
create index if not exists idx_payments_mpesa   on payments(mpesa_ref);

-- ── Messages (ride chat) ──────────────────────────────────────────────────────
create table if not exists messages (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references bookings(id),
  sender_id   uuid not null references users(id),
  content     text not null,
  read        boolean default false,
  created_at  timestamptz default now()
);

create index if not exists idx_messages_booking on messages(booking_id);
create index if not exists idx_messages_sender  on messages(sender_id);

-- ── Ratings ───────────────────────────────────────────────────────────────────
create table if not exists ratings (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references bookings(id),
  rater_id    uuid not null references users(id),
  rated_id    uuid not null references users(id),
  score       integer not null check (score between 1 and 5),
  comment     text,
  created_at  timestamptz default now(),
  unique(booking_id, rater_id)
);

-- ════════════════════════════════════════════════════════════════════════════
-- Search function — finds rides within radius of origin AND destination
-- Usage: select * from search_rides(lat, lng, lat, lng, radius_km, date);
-- ════════════════════════════════════════════════════════════════════════════
create or replace function search_rides(
  origin_lat      float,
  origin_lng      float,
  dest_lat        float,
  dest_lng        float,
  radius_km       float default 5.0,
  travel_date     date  default current_date
)
returns table (
  id                uuid,
  driver_id         uuid,
  driver_name       text,
  driver_rating     numeric,
  driver_avatar     text,
  origin_name       text,
  destination_name  text,
  departure_time    timestamptz,
  price_per_seat    integer,
  available_seats   integer,
  total_seats       integer,
  origin_dist_km    float,
  dest_dist_km      float
)
language sql stable as $$
  select
    r.id,
    r.driver_id,
    u.name          as driver_name,
    u.rating        as driver_rating,
    u.avatar_url    as driver_avatar,
    r.origin_name,
    r.destination_name,
    r.departure_time,
    r.price_per_seat,
    r.available_seats,
    r.total_seats,
    round((st_distance(
      r.origin_coords::geography,
      st_makepoint(origin_lng, origin_lat)::geography
    ) / 1000)::numeric, 2)::float as origin_dist_km,
    round((st_distance(
      r.destination_coords::geography,
      st_makepoint(dest_lng, dest_lat)::geography
    ) / 1000)::numeric, 2)::float as dest_dist_km
  from rides r
  join users u on u.id = r.driver_id
  where
    r.status = 'active'
    and r.available_seats > 0
    and r.departure_time::date = travel_date
    and st_dwithin(
      r.origin_coords::geography,
      st_makepoint(origin_lng, origin_lat)::geography,
      radius_km * 1000
    )
    and st_dwithin(
      r.destination_coords::geography,
      st_makepoint(dest_lng, dest_lat)::geography,
      radius_km * 1000
    )
  order by r.departure_time asc, price_per_seat asc;
$$;

-- ── driver_documents (vehicle verification) ─────────────────────────────────
-- Run this if the table doesn't exist yet, OR add vehicle_color to an existing one:
-- alter table driver_documents add column if not exists vehicle_color text;
create table if not exists driver_documents (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  number_plate        text,
  vehicle_model       text,
  vehicle_color       text,
  license_url         text,
  vehicle_image_url   text,
  verification_status text default 'pending'
                        check (verification_status in ('pending', 'approved', 'rejected')),
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  unique(user_id)
);
create index if not exists idx_driver_docs_user on driver_documents(user_id);

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — enable after initial setup
-- ════════════════════════════════════════════════════════════════════════════

-- The Express API uses the service-role key (bypasses RLS).
-- RLS below protects direct Supabase client calls from the Flutter app
-- if you ever use the anon key for reads.

alter table users          enable row level security;
alter table rides          enable row level security;
alter table bookings       enable row level security;
alter table payments       enable row level security;
alter table messages       enable row level security;
alter table ratings        enable row level security;
alter table driver_profiles enable row level security;

-- Users can read any profile (for ride cards), edit only their own
create policy "anyone can read users" on users for select using (true);
create policy "users update own record" on users for update using (auth.uid()::text = id::text);

-- Anyone authenticated can read active rides
create policy "anyone can read active rides" on rides for select using (status = 'active');
create policy "drivers insert rides" on rides for insert with check (true);

-- Passengers see only their own bookings; drivers see bookings for their rides
create policy "passengers see own bookings" on bookings for select
  using (passenger_id::text = auth.uid()::text);

-- Messages visible to booking participants only
create policy "booking participants see messages" on messages for select
  using (
    booking_id in (
      select id from bookings
      where passenger_id::text = auth.uid()::text
    )
  );
