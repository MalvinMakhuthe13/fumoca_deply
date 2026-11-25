# FUMOCA release gates

Branch: feature/4d-camera-timeline-v1
Not merged. Not deployed.

## Automated

29 Node suites. 28 passed on first run. One failure in anim-physics-studio-integration was a bad expected value. Corrected to the authored pose. Re-run: 15 passed.

Browser acceptance: not run. No Chromium session against Studio or the published viewer.

## Security

Founder gate is client-side. It blocks Studio when the allowlist is empty or the email does not match. It is not server-side RLS. Live Supabase and R2 policies were not inspected. Credentials were not available.

## Real assets

A generated GLB was written, parsed, bound, prepared and toggled. 7 passed. No commercial car, house or character GLB was tested.

## Do not advertise

Articulated visitor campaigns, physics grasp, character walk, mobile viewer, private client storage.

## Deploy

Do not merge or deploy until:
1. Founder email allowlist is set.
2. One published link is opened on a phone.
3. A stranger cannot fetch source files from that link.
4. You approve the deploy.

## Rollback

Production stays on main at 5fb490c until you approve. If a later deploy fails, redeploy that commit.
