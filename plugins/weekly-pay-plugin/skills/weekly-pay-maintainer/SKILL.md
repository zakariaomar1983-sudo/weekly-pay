---
name: weekly-pay-maintainer
description: Use when updating or debugging the Onpoint Express offline CRM pages, localStorage flows, exports, role permissions, or finance calculations.
---

# Weekly Pay Maintainer

## Purpose

Use this skill to safely modify the local offline CRM in this repository.

## Workflow

1. Read `README.md` to identify affected pages and scripts.
2. For each requested change, edit matching page pairs:
   - UI file: `*.html`
   - Logic file: `*.js`
3. Preserve offline-first behavior:
   - Do not introduce remote APIs unless explicitly requested.
   - Keep data in browser `localStorage`.
4. If modifying access behavior, update and verify `auth.js` role checks.
5. When changing table data, keep search/filter/export behavior consistent.
6. Validate by reviewing linked files and checking for obvious runtime errors.

## Project Map

- Drivers: `drivers.html`, `drivers.js`
- Trucks: `trucks.html`, `trucks.js`
- Roster: `roster.html`, `roster.js`
- Finance: `finance.html`, `finance.js`
- Logs: `log.html`, `log.js`
- Control panel: `control-panel.html`, `control-panel.js`
- Auth: `auth.js`, `login.html`, `login.js`

## Guardrails

- Keep naming and storage keys backward compatible when possible.
- Avoid destructive migrations unless requested.
- Keep edits focused and minimal.
