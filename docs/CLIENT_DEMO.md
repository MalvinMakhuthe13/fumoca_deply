# Client demo (local)

This is the page to screen-record. It is not on fumoca.co.za. Nothing in this branch was deployed, and no live Supabase, R2, DNS, or Cloudflare worker was changed.

## Run it

From the repo root, on branch `cursor/anim-client-demo-c441`:

```bash
./scripts/serve-local.sh
```

Open `http://localhost:8000/demo/index.html` on the machine running that server. Do not open the HTML file by double-click. ES modules do not run on `file://`.

Press **Camera body**. The camera eases open. Press it again and it eases shut, including if you press while it is still moving. The tripod does not move. A **Camera body** label sits on the body and moves with it. The **Lantern** control loads the second piece.

Studio, if you need to show preparation rather than the client view, is `http://localhost:8000/edit.html`. Click **Animate**, then **Load GLB**. Studio also drops a procedural cooler into the scene on boot. The client page does not.

## What the browser run proved

Command: `node tests/browser/articulated-asset.browser.mjs` against `http://127.0.0.1:8766`. Playwright Chromium, headless. It passed on 22 Nov 2026.

- Loaded Khronos `AntiqueCamera.glb` in Studio through **Load GLB** and the Articulate panel.
- Named the moving node **Camera body**, set a hinge on X, pivot about `(0, 5.356, 0)` metres in the parent (the bottom of the camera, not the origin), keyframed closed at 0 and open at π/2.
- Pressed the part. `jointError` was absent at closed and open. The tripod world pose stayed put.
- Pressed it 20 more times. Closed and open world positions matched the first pair. The tripod did not drift.
- Saved in the browser, reloaded Studio, loaded the same file. The hinge, the name, the non-zero pivot, and the open pose came back.
- Loaded a second, unrelated file, Khronos `Lantern.glb`. Named `LanternPole_Lantern` **Lamp head**, hinged it on Z. The lamp head moved. `LanternPole_Body` did not.
- Wrote `demo/records/antique-camera.json` (the camera only, no cooler). Opened `viewer.html?embed=1&localNif=/demo/records/antique-camera.json`. The visitor button opened and closed the same body. No Supabase row was read or written.
- A 390×844 Chromium viewport loaded `demo/index.html` and the press control worked inside the iframe.

That viewport is desktop Chromium with a phone-sized window. It is not a physical phone.

Later shots, after easing and the on-body label:

- `/opt/cursor/artifacts/viewer-hotspot-closed.png`
- `/opt/cursor/artifacts/viewer-hotspot-open.png`
- `/opt/cursor/artifacts/demo-phone.png`
- `/opt/cursor/artifacts/demo-phone-lantern.png`

Screenshots from the first run:

- `/opt/cursor/artifacts/viewer-camera-open.png`
- `/opt/cursor/artifacts/viewer-camera-closed.png`
- `/opt/cursor/artifacts/demo-phone.png`
- `/opt/cursor/artifacts/studio-camera-open.png`
- `/opt/cursor/artifacts/studio-lantern.png`

Recordings: `/opt/cursor/artifacts/articulation-capture-a.webm` and `articulation-capture-b.webm`.

## Assets and licences

| File | Source | Licence |
| --- | --- | --- |
| `demo/assets/AntiqueCamera.glb` | Khronos glTF-Sample-Assets, model AntiqueCamera, © 2018 UX3D | CC0 1.0. One tripod leg carries a UX3D logo. The Khronos card calls that logo non-copyrightable. Say that if a client asks. |
| `demo/assets/Lantern.glb` | Khronos glTF-Sample-Assets, model Lantern. © 2017 Microsoft (sbtron), Draco pass © 2018 Frank Galligan | CC0 1.0 |

Both are meshes. Neither is a Gaussian splat.

## Shoe

There is no shoe PLY, splat, or mesh in this repo. Nothing was classified because there is no file.

A Gaussian PLY is a cloud of oriented blobs. It is not a rig. The smallest preparation, when a shoe file exists:

1. Read the header and attributes. If it has Gaussian scales and rotations (or spherical harmonics), it is a splat. If it is only `xyz` and colour, it is a point cloud. The extension does not decide.
2. Leave that splat where it is, as the visual background.
3. Build a separate mesh for the tongue or the strap. Hinge that mesh.
4. Do not rotate the whole shoe, and do not turn the splat into joints.

## Unit and integration tests

`node scripts/run-anim-tests.mjs` ran all 30 `tests/anim-*.test.mjs` files after `three@0.180.0` and `@dimforge/rapier3d-compat@0.21.0` were installed. All 30 passed, including the new parent-mismatch test (5 assertions) and the suites that previously could not start because they imported `/workspace/artifacts` or `/tmp`.

Counts from that run include joint-eval 47, schema-migration 43, articulated-pot 11, master (fake quaternion) 31, joint-integration 65, glb-bind 10, glb-real 7, scenes 12, physics query 15, physics studio integration 15, live 6, afford 7. CI (`.github/workflows/fumoca-validation.yml`) now installs those two packages and runs `node scripts/run-anim-tests.mjs` on pull requests into `feature/**` as well as `main`. The workflow still does not deploy.

## Added after the first demo

These were re-checked on this branch. Counts are from the commands named.

| Check | Command | Result |
| --- | --- | --- |
| Ease, reverse, 20 cycles | `node tests/anim-ease.test.mjs` | 14 passed |
| Ease in the viewer | `node tests/browser/articulated-ease.browser.mjs` | passed |
| Anchor follows the hinge | `node tests/anim-anchor.test.mjs` | 5 passed |
| Label in the viewer | `node tests/browser/articulated-hotspot.browser.mjs` | passed |
| Upload prefix | `node cloudflare/tests/upload-publish.test.mjs` | 31 passed |
| Hinge vs dynamic bottle | `node tests/anim-ownership-rule.test.mjs` | 7 passed |
| Same rule in Chromium | `node tests/browser/articulated-ownership.browser.mjs` | passed |
| Landing and lantern switch | `node tests/browser/demo-landing.browser.mjs` | passed |
| Ordered sequence | `node tests/anim-sequence.test.mjs` | 8 passed |
| Sequence in Chromium | `node tests/browser/articulated-sequence.browser.mjs` | passed |

Presses use `FumocaMaster`'s existing loop. `PUT /upload/:key` and the multipart routes call `authorizeStoredKey`, the same prefix rule as presign. That code is not deployed. A hinged component is authored, so a dynamic body on that same node does not write it. The bottle in the ownership test is a different node and does fall.

The sequence runs the lamp head, then the camera body, on that same loop. The browser sequence used a two-hinge test scene with those names. It did not load both GLB files into one view.

GitHub Actions `static-and-glb-preflight` succeeded on `81e1aa8`. The Cloudflare Pages check on that commit failed immediately. Its log is only on the Cloudflare dashboard, which this session cannot read. No deploy was started from here.

## What is not proven

- Production. fumoca.co.za does not run this branch.
- A real phone, a published fumoca.co.za link, or a deployed worker. The phone shots are Chromium at 390×844.
- Rapier inside the client demo. The demo is a hinge. The falling bottle was a separate test.
- Cloth, soft body, characters, or AI motion.
- The two GLB files playing one sequence together. The sequence proof is the two-hinge test scene.
- A Gaussian product with an articulated mesh in front of it.
- The upload prefix change on the live worker. The routes in this branch call the same check as presign. Nothing was deployed.

## What you have to do by hand before a client

Do these yourself. This session did not do them.

1. Show the client `demo/index.html` from your laptop, or a link you publish later. Do not send `edit.html`. Clients do not get Studio.
2. Studio’s gate is the email list in `config.js`: `window.FUMOCA_FOUNDER_EMAILS = ['your@email']`. An empty list blocks everyone, in the browser only. That is not the server check.
3. The Publish button now calls `GET /founder/me` on the R2 worker when `r2WorkerUrl` is set. That route validates the token and then calls `canPublish`, which allows the publish only if the Supabase user id is in the worker variable `FUMOCA_FOUNDER_IDS`. Set that variable to your user id and deploy **this** worker before you trust Publish. If the worker URL is set and the check does not return success, Publish stops before any upload. If the worker URL is empty, Publish falls back to the email list above.
4. `engine-next/db-reference/storage-privacy-proposed.sql` is still only a proposal. It would set the `splat-videos` and `splat-files` buckets to private. Do not run it against production until you mean to. The rollback is in that file.
5. Do not merge this branch to `main` and do not deploy it to fumoca.co.za until you have watched the local demo. `main` does not contain this work.
6. A client link on the public site still needs a real published NIF. This demo uses a local JSON file. Publishing that file was not done, on purpose.
