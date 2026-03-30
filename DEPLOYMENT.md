# CONVERA — Deployment Guide (Next.js)
## وزارة البلديات والإسكان — إدارة التطوير والتأهيل

> Last updated: March 2026

---

## Architecture

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Next.js 14 App Router (TypeScript) | RTL Arabic, MasmakBHD font |
| Database | Supabase (PostgreSQL 15+) | RLS enforced |
| Auth | Supabase Auth (email/password) | Reset flow via email |
| Storage | Supabase Storage (documents bucket) | PDF attachments |
| Hosting | Netlify + @netlify/plugin-nextjs | Auto-deploy from Git |

---

## Step 1 — Supabase Setup

### 1.1 Run Database Migrations (in order)
Open Supabase SQL Editor and run:

```
SQL/migrations/001_base_schema.sql
SQL/migrations/002_step0_fixes.sql
SQL/migrations/003_change_orders_and_hardening.sql
SQL/migrations/004_contract_templates_and_progress_models.sql
SQL/migrations/005_rls_prototype_access.sql   ← DEV ONLY — remove before production
```

### 1.2 Run Seed Files
```
SQL/seeds/001_seed_profiles.sql
SQL/seeds/002_seed_contracts.sql
```

### 1.3 Configure Supabase Auth
In **Supabase Dashboard → Authentication → URL Configuration**:

| Setting | Value |
|---|---|
| Site URL | `https://convera.momah.gov.sa` |
| Redirect URL (prod) | `https://convera.momah.gov.sa/reset-password` |
| Redirect URL (dev) | `http://localhost:3000/reset-password` |

### 1.4 Configure SMTP (for password reset emails)
In **Supabase Dashboard → Project Settings → Auth → SMTP Settings**:
- Enable custom SMTP
- Use the ministry's official SMTP server

---

## Step 2 — Environment Variables

### Local Development
```bash
cp .env.example .env.local
# Edit .env.local with your Supabase credentials
```

### Netlify Production
Go to **Netlify → Site settings → Environment variables** and add:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_...` |

> **Do NOT add `SUPABASE_SERVICE_ROLE_KEY` to Netlify** — it would be exposed to the browser.

---

## Step 3 — Deploy to Netlify

### Option A: Git Auto-deploy (Recommended)
1. Push code to GitHub
2. Connect repo to Netlify project (`convera-momah`)
3. Netlify auto-deploys on every push to `main`

### Option B: Netlify CLI
```bash
cd FRONTEND
npm install
npm run build
npx netlify-cli deploy --prod
```

### Option C: Local Development
```bash
cd FRONTEND
npm install
npx next dev --port 3000
```

---

## Step 4 — Production Security Checklist

Before going live:

- [ ] Remove `SQL/migrations/005_rls_prototype_access.sql` (open access — dev only)
- [ ] Apply production RLS policies (Sprint 5 — item 39)
- [ ] Change all user passwords from the seed default (`0555180602`)
- [ ] Configure Supabase SMTP with official ministry email server
- [ ] Verify custom domain DNS points to Netlify
- [ ] Enable Netlify HTTPS (automatic with Let's Encrypt)
- [ ] Test password reset email flow end-to-end
- [ ] Verify Supabase Redirect URLs include the production domain

---

## User Accounts (Seeded)

| Name | Email | Role | Temp Password |
|---|---|---|---|
| محمد العرفج | Ma.Alarfaj@momah.gov.sa | director | `0555180602` |
| حسام الحبلين | halhablayn-Contractor@momah.gov.sa | auditor/admin | `0555180602` |
| أحمد الراشدي | reviewer@momah.gov.sa | reviewer | `0555180602` |
| محمود رجب | mahmoud.ragab@beeah.sa | supervisor | `0555180602` |
| عبدالله البهدل | abdullah.albahdal@beeah.sa | contractor | `0555180602` |
| مالك العقاب | arfaj001@gmail.com | contractor | `0555180602` |

> **IMPORTANT:** Change all passwords before production deployment.

---

## Auth Flows

### Login
`/login` → Supabase `signInWithPassword()` → redirect to `/dashboard`

### Forgot Password
`/forgot-password` → `resetPasswordForEmail()` → Email with link → `/reset-password?code=xxx`

### Reset Password
`/reset-password?code=xxx` → `exchangeCodeForSession(code)` → password form → `updateUser({ password })` → redirect `/login`

---

## Troubleshooting

**Build fails: "Cannot find module"**
> Run `npm install` in the `FRONTEND/` directory

**Login works but data shows empty**
> Run `005_rls_prototype_access.sql` (dev only) or check RLS policies

**Password reset email not arriving**
> Check Supabase SMTP settings; verify email is in auth.users

**Reset link shows "invalid code"**
> The PKCE code is single-use and expires in 1 hour. Request a new link.
> Verify `/reset-password` is in Supabase Redirect URLs.

**CSP blocking Supabase requests**
> Update `next.config.mjs` CSP `connect-src` to include your Supabase project URL
