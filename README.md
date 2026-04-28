# Ride Pamoja API

REST API backend for **Ride Pamoja** — a peer-to-peer ride-sharing platform built for Kenya. Drivers post routes they're already making; passengers book seats and pay cash on arrival.

**Production URL:** `https://ride-pamoja-api-production.up.railway.app`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express.js |
| Database | PostgreSQL via Supabase |
| Auth | JWT (HS256) + Google OAuth |
| Hosting | Railway (auto-deploy from GitHub) |
| Security | Helmet, CORS, express-rate-limit |

---

## Getting Started

### Prerequisites
- Node.js 18+
- A [Supabase](https://supabase.com) project with the schema applied (see `src/utils/schema.sql`)
- A Google Cloud project with an OAuth Web Client ID

### Installation

```bash
git clone https://github.com/muslimcreates/ride-pamoja-api.git
cd ride-pamoja-api
npm install
cp .env.example .env   # fill in your values
npm run dev
```

### Environment Variables

```env
PORT=3000
NODE_ENV=development

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key

# JWT
JWT_SECRET=your-long-random-secret
JWT_EXPIRES_IN=30d

# Google OAuth (Web Client ID from Google Cloud Console)
GOOGLE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
```

---

## Database Setup

Run `src/utils/schema.sql` in your Supabase SQL Editor. It creates all tables, indexes, RLS policies, and the `search_rides` PostGIS function.

**Tables:**

| Table | Description |
|---|---|
| `users` | All users — passengers and drivers |
| `rides` | Rides posted by drivers |
| `bookings` | Seat reservations (passenger ↔ ride) |
| `messages` | In-app chat between booking participants |
| `driver_documents` | Verification docs (licence, vehicle, plate) |
| `payments` | M-Pesa payment records (future use) |
| `ratings` | Post-trip ratings between users |
| `otp_codes` | Legacy phone OTP — one record per number |

---

## API Reference

All routes (except `/health` and unauthenticated auth routes) require a Bearer token:

```
Authorization: Bearer <jwt>
```

Errors follow the format: `{ "error": "message" }`

---

### Health

```
GET /health
```

```json
{
  "status": "ok",
  "service": "Ride Pamoja API",
  "version": "1.0.0",
  "timestamp": "2026-04-27T08:00:00.000Z"
}
```

---

### Auth — `/api/auth`

Rate limit: 20 requests per 15 minutes per IP.

#### Register
```
POST /api/auth/register
```
```json
{
  "name": "Amina Wanjiku",
  "email": "amina@example.com",
  "password": "Str0ng!Pass"
}
```
**Response `201`**
```json
{
  "token": "<jwt>",
  "isNewUser": true,
  "user": { "id": "...", "name": "Amina Wanjiku", "email": "...", "role": "passenger" }
}
```

#### Login
```
POST /api/auth/login
```
```json
{ "email": "amina@example.com", "password": "Str0ng!Pass" }
```
**Response `200`** — same shape as register.

#### Google Sign-In
```
POST /api/auth/google
```
```json
{ "idToken": "<google-id-token>" }
```
Verifies the token with Google, creates or links the account, returns JWT. `isNewUser: true` on first sign-in.

#### Complete Profile
```
POST /api/auth/profile          🔒 requires auth
```
```json
{
  "name": "Amina Wanjiku",
  "national_id": "12345678",
  "role": "passenger",
  "avatar_url": "https://..."
}
```

#### Get Current User
```
GET /api/auth/me                🔒 requires auth
```

---

### Rides — `/api/rides`

All ride routes require auth.

#### Search Rides
```
GET /api/rides/search?from=Westlands&to=CBD&date=2026-04-27
```
Returns active rides whose `origin_name` and `destination_name` match the query strings (case-insensitive). Filtered by departure date if provided.

**Response**
```json
{
  "rides": [
    {
      "id": "...",
      "origin_name": "Westlands",
      "destination_name": "CBD, Nairobi",
      "departure_time": "2026-04-27T07:00:00Z",
      "price_per_seat": 120,
      "available_seats": 3,
      "total_seats": 4,
      "driver": { "id": "...", "name": "John Otieno", "rating": 4.8, "avatar_url": "..." }
    }
  ]
}
```

#### Upcoming Rides
```
GET /api/rides/upcoming?limit=8
```
Active rides departing in the future, ordered by departure time. Includes driver info (with vehicle and plate from `driver_documents`) and a preview of confirmed passengers.

#### Get Ride
```
GET /api/rides/:id
```

#### Post a Ride
```
POST /api/rides               🔒 driver/both role required
```
```json
{
  "origin_name": "Westlands",
  "destination_name": "CBD, Nairobi",
  "departure_time": "2026-04-27T07:00:00Z",
  "price_per_seat": 120,
  "total_seats": 4,
  "notes": "Meet at Total petrol station"
}
```

#### Update / Cancel a Ride
```
PATCH /api/rides/:id          🔒 driver/both role required
```
```json
{ "status": "cancelled" }
```

---

### Bookings — `/api/bookings`

All booking routes require auth.

#### Book a Seat
```
POST /api/bookings
```
```json
{ "ride_id": "...", "seats": 1 }
```
Uses **optimistic locking** — atomically decrements `available_seats` in a single conditional `UPDATE`. If two requests land simultaneously, only one wins; the other receives `409 Conflict`.

**Response `201`**
```json
{ "booking": { "id": "...", "status": "confirmed", "total_amount": 120, ... } }
```

**Error cases:**

| Status | Reason |
|---|---|
| `400` | Ride not active / not enough seats |
| `400` | Driver trying to book their own ride |
| `409` | Already booked this ride |
| `409` | Race condition — seat taken by concurrent request |

#### Get Booking
```
GET /api/bookings/:id
```
Only accessible by the passenger or the driver of that ride.

#### Cancel Booking
```
PATCH /api/bookings/:id/cancel
```
Restores `available_seats` on the ride.

#### My Bookings (passenger)
```
GET /api/bookings/my
```

#### My Posted Rides (driver)
```
GET /api/bookings/my/driver    🔒 driver/both role required
```

#### My Earnings (driver)
```
GET /api/bookings/my/earnings  🔒 driver/both role required
```
Returns total earned, this-month earned, and a per-ride breakdown.

#### Conversations Inbox
```
GET /api/bookings/my/conversations
```
Returns all bookings the user is part of (as passenger or driver), formatted for the chat inbox.

---

### Messages — `/api/messages`

All message routes require auth. Participants are verified on every request.

#### Get Messages
```
GET /api/messages?booking_id=<id>
```

#### Send Message
```
POST /api/messages
```
```json
{ "booking_id": "...", "content": "I'm at the gate" }
```

---

### Driver Verification — `/api/driver`

#### Submit Verification
```
POST /api/driver/verify        🔒 requires auth
```
```json
{
  "number_plate": "KDJ 123A",
  "vehicle_model": "Toyota Vitz",
  "license_url": "https://...",
  "vehicle_image_url": "https://..."
}
```
Saves documents to `driver_documents` and immediately upgrades the user's role to `both` so they can post rides.

#### Get Verification Status
```
GET /api/driver/verify         🔒 requires auth
```

---

## Rate Limiting

| Scope | Limit |
|---|---|
| All `/api/*` routes | 100 req / 15 min per IP |
| Auth routes (`/register`, `/login`, `/google`) | 20 req / 15 min per IP |
| Legacy OTP routes | 5 req / 15 min per IP |

---

## Security

- **Helmet** sets secure HTTP headers on every response
- **JWT** tokens are signed with `JWT_SECRET` and expire after 30 days
- **Service-role Supabase key** is used server-side only — never exposed to clients
- **RLS policies** in Supabase protect direct database access if the anon key is ever used from the client
- **Passwords** are hashed with bcrypt (12 rounds)
- **Google tokens** are verified directly with Google's tokeninfo endpoint before any account action

---

## Deployment

Railway auto-deploys from the `main` branch of this repository. After pushing:

1. Open the Railway dashboard
2. Watch the **Deployments** tab — build takes ~30 seconds
3. Once status shows **Active**, the new version is live

To push backend changes:

```bash
git add src/
git commit -m "feat: your change"
git push
```

---

## Project Structure

```
src/
├── controllers/
│   ├── authController.js       # register, login, Google OAuth, profile
│   ├── bookingsController.js   # bookings CRUD, earnings, conversations
│   ├── driverController.js     # driver verification
│   ├── messagesController.js   # in-app chat
│   └── ridesController.js      # rides CRUD, search, upcoming
├── middleware/
│   ├── auth.js                 # requireAuth, requireDriver
│   └── errorHandler.js         # global error handler
├── routes/
│   ├── auth.js
│   ├── bookings.js
│   ├── driver.js
│   ├── messages.js
│   ├── payments.js
│   └── rides.js
├── services/
│   └── supabaseClient.js       # Supabase admin client (service-role key)
├── utils/
│   ├── jwt.js                  # signToken / verifyToken
│   ├── otp.js                  # legacy OTP helpers
│   └── schema.sql              # full Supabase schema
└── index.js                    # Express app entry point
```

---

## License

Private — Ride Pamoja © 2026. All rights reserved.
