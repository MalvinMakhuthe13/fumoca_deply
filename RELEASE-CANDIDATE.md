# FUMOCA release candidate

Branch: `feature/4d-camera-timeline-v1`
Not deployed. Not merged.

## What this candidate includes

- Founder gate on Studio and the founder desk. Set `window.FUMOCA_FOUNDER_EMAILS` to the founder address. An empty list blocks everyone.
- Job rerun updates the existing `nif_files` row by `job_id`.
- Synthetic or non-COLMAP poses already mark the job `needs_retry`. `pose_quality` is now stored on the NIF meta.
- Studio articulation: car, house, bottle, press-to-open, person and animal skeletons, demo cooler, drop bottle.
- Founder desk for leads, clients, projects and quotes.
- Launch checklist.

## Not in this candidate

- Production deploy.
- Live Supabase RLS changes. Those need credentials and approval.
- Private R2 bucket migration. Needs storage config approval.
- Public website redesign. Out of scope.
- Browser acceptance on a phone. Not run here.
- Backup restore demonstration. Needs production access.

## Deploy

Do not deploy until the founder email allowlist is set and a published link is tested on a phone.

## Rollback

Stay on `main` at `5fb490c`. This branch is additive. Revert the branch deploy if one is made.
