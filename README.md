# Onpoint Express CRM

Transport operations CRM with pages for:
- Drivers
- Trucks
- Weekly Roster
- Finance and Payslips
- Logs
- Control Panel (roles, users, backup/restore)

## Project Files
- `index.html` home page
- `index.js` home page logic
- `login.html` login page
- `login.js` login logic
- `drivers.html` drivers page UI
- `drivers.js` drivers page logic and CSV export
- `trucks.html` trucks page UI
- `trucks.js` trucks page logic and CSV export
- `roster.html` weekly roster page UI
- `roster.js` weekly roster logic and CSV export
- `finance.html` finance + payslip page UI
- `finance.js` weekly truck income, truck expense, driver pay, and profit logic
- `log.html` log page UI
- `log.js` log page logic and CSV export
- `control-panel.html` role and user management page
- `control-panel.js` control panel logic
- `auth.js` authentication and role-permission engine
- `style.css` shared design
- `supabase-config.js` Supabase URL/key configuration
- `supabase-client.js` Supabase client bootstrap and fallback loader
- `seed-data.js` emergency local data seed (loads only when storage is empty)

## First Run
1. Open `login.html`.
2. If no users exist, use the first-run form to create:
- Admin user
- Optional Ops Manager user
- Optional GM user
3. Sign in and open `Control Panel` to manage roles/users.

## Data Storage Behavior
- Primary: browser `localStorage` per device.
- Supabase sync is available when configured.
- If local storage is empty, `seed-data.js` can preload base data snapshot.

## Local Development
1. Install dependencies:
```bash
npm install
```
2. Run local server (example):
```bash
npx vite
```
3. Open local URL shown in terminal.

## Vercel Deploy (Production)
1. Link this folder to the correct Vercel project:
```bash
npx vercel link
```
Choose project: `weekly-pay`.

2. Deploy production:
```bash
npx vercel --prod
```

3. Open production:
- `https://weekly-pay.vercel.app/control-panel.html`
- `https://weekly-pay.vercel.app/drivers.html`
- `https://weekly-pay.vercel.app/trucks.html`
- `https://weekly-pay.vercel.app/finance.html`

## Supabase Setup
1. Set values in `supabase-config.js`:
- `url` = your project URL (for example `https://xxxxx.supabase.co`)
- `anonKey` = anon public key
2. Ensure tables exist:
- `drivers`
- `trucks`
- `truck_income`
- `truck_expense`
- `payslips`
3. If data still does not appear, verify RLS/policies for anon access.
