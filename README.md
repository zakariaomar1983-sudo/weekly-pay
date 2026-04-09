# Onpoint Express Operations CRM (Offline)

Simple CRM for Onpoint Express with separate secured pages for:
- Driver details
- Truck details (including truck number)
- Weekly roster
- Finance and driver pay
- Logs
- Role and user control panel

## How to use
1. Open `login.html` in your browser.
2. Login with default admin: `admin` / `admin123`.
3. Use `Control Panel` to create roles and users with access levels.
4. Open Home (`index.html`) and navigate to:
   - `drivers.html`
   - `trucks.html`
   - `roster.html`
   - `finance.html`
   - `log.html`
   - `control-panel.html`
5. Use `Edit` / `Delete` / `Export CSV` where the role allows it.
6. Use the `Search` boxes on Drivers, Trucks, Weekly Roster, Logs, and Finance history tables to find records quickly.

## Notes
- Data is saved in your browser `localStorage` on this computer.
- If you clear browser storage, data is removed.
- Password and roles are local to this browser (offline mode).

## Files
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
