# Where FUMOCA stands — October 2026

A browser page cannot out-train Postshot, and it cannot invent a floor plan the way Matterport does. Those stay on a scanner or a GPU. This is the gap, then the controls that now exist.

## What the field ships

| Tool | What it is good at | What it does not give you |
|---|---|---|
| Postshot, Lichtfeld, Brush, gsplat | Train a real anisotropic splat from photos or video. This is the picture quality. | No social feed, no NIF, no ad timeline. |
| COLMAP | Camera poses. Without it the cloud is a guessed orbit and falls apart off-axis. | No colour splat, no product page. |
| SuperSplat 3.6 (March–October 2026) | Crop, measure, two-point upright, walk mode, streamed SOG LOD, colour, WebGPU editor, annotations. | Not a feed. Walk mode needs a voxel collision mesh. |
| Spark / FiftyOne | .spz, .sog, .ply, .splat, .ksplat, paged LOD, SH quality. | Not a client editor. |
| KIRI 4.2 | Phone capture, 3DGS-to-mesh, measure, print scale, Blender and After Effects. | Research meshers (2DGS, SuGaR, Gaussian Opacity Fields) are non-commercial. |
| Polycam, Luma, Scaniverse | Fast cloud capture clients already know. | You do not own the pipeline. |
| Matterport | Dollhouse, hop-between scans, tape measure, floor plan. Camera from about $3,995 plus a plan. | A mesh tour, not a photographic splat, and not your file. |
| SwitchSplat (SIGGRAPH Asia 2026) | Each door or light captured once, both states kept, combinations the video never showed. | A training paper, not a script tag. |
| Apple SHARP | One photo to about 1.2 million Gaussians. | Weak if someone must walk inside. |
| 4DGS | Replays motion. | Cannot open a door at a moment that was never filmed. |

The 2026 buyer rule used by studios: Matterport when the job is “walk this house and measure it”, a splat when the job is “this object or room must look like the photograph”, photogrammetry when the job is a watertight mesh for print or CAD.

## What was broken here

- Every decoded NIF was sent to a point renderer, including real splats. Real splats stay on the Gaussian renderer. A uniform cloud uses solid points.
- A video on the same page could hide the stage. Split, stack, pip, and background keep it visible.
- Pip was 300×170. It is 200×112.

## Controls added

They sit under **Studio tools**, closed until opened, so they do not cover the subject.

| Control | What it does | Honest limit |
|---|---|---|
| Orbit | Tumble around the subject. | |
| Walk | W forward, S back, A left, D right, Space up, C down. Double-click glides to that surface. | No floor collision. You can pass through a wall. SuperSplat blocks that with a voxel mesh. |
| Measure | Two clicks, distance. | Scene units unless the file has metres-per-unit. Not a Matterport tape. |
| Upright | Two clicks on a vertical edge, same idea as SuperSplat 3.6. | Point view. A trained splat still uses the editor transform. |
| Dollhouse | Camera above the subject. | A view, not a generated floor plan. |
| Detail, size, light, crop, backdrop | Thin the cloud, scale points, lift colour, cut the edges, change the ground. | Detail is a stride, not streamed SOG. |
| Parts | Door, lights, boot, drawer. | A flag and a sound. The open shape has to be trained or baked. |
| Hide floaters | Drops isolated points. | Not a brush. |

## Still not in the browser

SOG streamed LOD, WebGPU brush selection, spherical-harmonic band export, SwitchSplat learned slots, COLMAP, a watertight print mesh, and an automatic floor plan.

## How a client job should run

1. Overlapping video or photos, slow, outside and inside if they must walk through.
2. COLMAP, then a GPU train. Export a `.ply` with scales and rotations, not a point list.
3. Clean: crop, hide floaters, upright from a door edge, save the angles a buyer lands on.
4. If a door or a light must change, capture that state once and bind it.
5. Publish the NIF with the review video. The viewer keeps both.
6. Share the link. The page is the deliverable, and the file stays yours.
