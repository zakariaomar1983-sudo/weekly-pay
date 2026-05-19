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
2. Run the bundled local server (serves pages + `/api/*` routes):
```bash
npm run dev
```
3. Open local URL shown in terminal.
4. Run the route health check before deploy:
```bash
npm run health-check
```

Alternative: `npx vercel dev` if you want Vercel emulation.

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

## Project AI Knowledge Training
This project now includes an offline knowledge indexing flow so your AI can answer using your codebase plus selected Slack notes.

1. Train/build the knowledge index:
```bash
npm run ai:train
```

2. Start the local server:
```bash
npm run dev
```

3. Ask for grounded project context:
```bash
curl "http://localhost:4173/api/project-ai-context?q=how%20do%20weekly%20report%20emails%20work&topK=6"
```

4. Ask for a direct final answer (with source citations):
```bash
curl "http://localhost:4173/api/project-ai-chat?q=how%20do%20weekly%20report%20emails%20work&topK=6"
```

### Boolean Feature Flag
- `FEATURE_PROJECT_AI_CHAT_ENABLED` controls `/api/project-ai-chat`
- Default: `true`
- Set to `false` to disable the endpoint

### Files Used by the AI Flow
- `scripts/build-project-knowledge.js`: scans project files and builds `ai-data/project-knowledge.json`
- `ai-data/slack-notes.json`: hand-picked Slack notes to include in training context
- `api/project-ai-context.js`: query endpoint that returns top relevant context chunks and sources
- `api/project-ai-chat.js`: query endpoint that returns a final answer grounded in the indexed project sources

### Updating Slack Knowledge
Edit `ai-data/slack-notes.json` and run `npm run ai:train` again to refresh the index.
