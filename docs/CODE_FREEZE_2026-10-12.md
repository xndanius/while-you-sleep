# Lecture code freeze

Danielius via Claude requested no code deployments from **Monday 12 October 2026 18:00** until **Tuesday 13 October 2026 15:00**, Europe/Vilnius. This is 12 October 15:00 UTC through 13 October 12:00 UTC, with the end excluded.

Before the window, the maintainer seals the final tested code with `node scripts/seal-code-freeze.mjs`. The baseline lists SHA256 hashes of workflows, prompts, scripts, libraries, tests, dependencies, browser code/assets, AGENTS.md and RULES.md. Pages checks the exact inventory before building during the window; an added, removed or changed code file blocks deployment. The baseline cannot be resealed during the freeze.

The hosted clock and hourly loop remain active. Checked content, rejection and unverified no-post records, source discovery/registry changes, measurements, cost tables and RSS/Pages builds continue using unchanged code. Published posts are not deleted. Generated card images and feed/metadata pages remain content outputs and are validated by the existing publication gates. An evaluated rules proposal cannot be adopted during the freeze; its rejection and evaluation are still recorded.

The window is shown on `/machine/` and in `/api/machine.json`. This freeze does not promise a post every hour: only fresh, independently verified, nonduplicate ideas at the unchanged threshold may publish.
