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
