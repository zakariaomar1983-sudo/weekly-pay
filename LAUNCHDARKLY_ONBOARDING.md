# LaunchDarkly Onboarding Log

Last updated: 2026-05-17 (Australia/Sydney)

## Checklist
- Step 0: Onboarding log — done
- Step 1: Explore project and integration surface — done
- Step 2: Detect agent environment — done
- Step 3: Install companion flag-management skills — done (installed from local LaunchDarkly package due network/TLS and folder-permission constraints)
- Step 4: Configure MCP server — in progress (hosted endpoint added; awaiting agent restart for tool availability)
- Step 5: Install and initialize SDK — not started
- Step 6: Create first feature flag and verify toggle path — not started

## Context
- Agent: codex
- Project path: C:\Users\zakar\OneDrive\WEEKLY PAY
- Language/runtime: JavaScript (Node.js)
- Framework/app type: Vanilla JS multi-page app + Node local server + Vercel cron/api routes
- Monorepo target path: N/A (single repo)
- LaunchDarkly status: not integrated in application code yet (no SDK usage found)
- LaunchDarkly project key: unknown
- LaunchDarkly environment key: unknown

## MCP
- Configured: pending verification
- Mode: hosted MCP preferred
- Config path: user supplied
  - `[mcp_servers.launchdarkly-v2]`
  - `url = "https://mcp.launchdarkly.com/mcp/fm"`
  - `http_headers = {}`

## Commands Run
- `npx skills add launchdarkly/agent-skills --skill onboarding -y`
- `npx.cmd skills add launchdarkly/agent-skills --skill onboarding -y`
- `npx.cmd skills --help`
- `npm.cmd install --no-audit --no-fund .\\.ld-agent-skills-main-extract\\ai-tooling-main`
- `npx.cmd skills experimental_sync -y`
- Local copy fallback to global Codex skills:
  - `C:\Users\zakar\.codex\skills\onboarding`
  - `C:\Users\zakar\.codex\skills\launchdarkly-flag-{create,discovery,targeting,cleanup}`

## Blockers / Errors
- PowerShell policy blocked `npx.ps1`; switched to `npx.cmd`.
- GitHub clone via `skills add` failed with schannel TLS (`SEC_E_NO_CREDENTIALS`).
- Installer could not write to workspace `.agents\skills` (`EPERM`).
- Resolved by installing from local LaunchDarkly package already present in workspace and copying skills into global Codex skills directory.

## Next step
Step 4: Restart/refresh the agent and verify MCP tool availability.
