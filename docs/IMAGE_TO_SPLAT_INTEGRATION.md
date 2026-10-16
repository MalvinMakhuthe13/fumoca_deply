# Image-to-Splat, mesh conversion, and lighting plan

Status: **Studio Phase 1 merged to main**. The page previews selected local images and exports a ZIP with the original files plus camera-plan JSON. It does not run reconstruction or create splats.

## Existing image-to-splat scaffold
- User-selected images remain local until a future, authenticated upload flow is implemented.
- Camera plan records planned poses, relative scene units, and provenance. It intentionally does not claim metric scale.
- AI-generated views must stay explicitly labelled as inferred/synthetic and separated from captured evidence.
- Image2Splat remains an isolated upstream application until a worker API and artifact contract are implemented.

## Mesh2Splat research candidate

Upstream: https://github.com/electronicarts/mesh2splat

The upstream README describes an OpenGL/C++ desktop program that converts **textured GLB** assets into Gaussian splats. It supports adjustable sampling density and documents diffuse, metallic-roughness and normal maps, PBR-based shading, relightable Gaussians, a point light and omnidirectional shadow mapping. It also documents a desktop renderer with shader hot-reload and mesh/Gaussian occlusion. These capabilities are relevant to FUMOCA's goals, but must not be advertised as implemented in FUMOCA yet.

### Important limits
- This is a mesh-to-splat conversion step, **not** image-to-3D reconstruction. FUMOCA must first produce a valid mesh with texture/material data.
- README currently documents only GLB input.
- The repository is a desktop OpenGL/C++ app with an interactive renderer. It does not document a headless CLI or a callable Kaggle API. A worker adapter or a carefully separated CLI mode would need engineering and tests.
- It can produce a useful geometry/material-informed splat and a strong initialization for further optimization, but this alone does not recover details missing from the mesh or guarantee superior quality.
- For foliage, hair, clouds and volumetric/non-triangle geometry, their README warns results may be incorrect.
- EA's `LICENSE.txt` is a custom permissive-style license with attribution/redistribution conditions and restrictions on using EA names/marks for endorsement. Review this license with intended commercial use before distributing a binary, bundling code or branding an integration. Do not imply EA endorses FUMOCA.

## Intended FUMOCA pipeline (Kaggle GPU remains the processing target)

1. **Reconstruct** using the existing, unchanged production path.
2. **Validate and export textured GLB** from mesh geometry, UVs, normals, and supported texture maps. Preserve original mesh and textures for rollback.
3. **Mesh QA/cleanup**: validate finite coordinates, faces/normals, UVs, texture references, scale/calibration metadata, watertightness where appropriate, and object bounds. Save a source-mesh checksum and QA report.
4. **Optional Mesh2Splat adapter** runs only for compatible GLB inputs, in an isolated Kaggle job. Pin repository commit and compiler/runtime. Keep output and logs per-job; do not use a GUI-only executable in a headless notebook without verifying it can run there.
5. **Output QA** checks file signature/format, finite parameters, non-empty splat count, scene bounds, and renders comparison views against the mesh/source images. Compare silhouette, colour/texture, surface coverage and scale before publishing.
6. **Viewer/format adapter** converts or packages only with a tested output contract. Do not assume Mesh2Splat output is already accepted by FUMOCA's viewer or NIF format.
7. **Publish** only the verified output. If conversion fails, keep the original mesh and existing reconstruction result available.

## Lighting goals

Separate **relighting the asset** from **lighting the viewer**:
- For textured meshes/GLB: maintain albedo and supported PBR texture maps/material parameters.
- For Gaussian splats: use a renderer that supports the needed material/relighting model. Plain colour SH splats and surface splats do not necessarily behave like physically based materials.
- Viewer controls to plan: ambient/environment intensity, key light intensity and direction, optional point light, exposure/tone mapping, and shadows only when the renderer supports them.
- Add an A/B switch for original appearance vs. relit preview, and keep original material/texture data.
- Document any renderer that bakes light into colours; baked illumination cannot be reliably removed later.
- Mesh2Splat documents relightability and PBR shading in its own renderer. **FUMOCA still needs a tested viewer implementation** and may need to adapt the splat material data to the viewer's supported representation.

## Kaggle rollout gates
- Do not add the converter to the current production worker until its headless runtime is proven.
- Build/test in a separate Kaggle notebook or optional worker image so current jobs cannot be destabilized.
- Start with one known, textured GLB fixture. Run conversion and compare the output in the upstream renderer and FUMOCA's target viewer.
- Record CPU RAM, GPU RAM, execution time, source/output sizes, error logs, and QA metrics.
- Add timeout, cancellation, retry policy, temporary-directory cleanup, and a maximum asset size.
- Store artifact paths and status using verified Supabase schema/RLS; never expose service secrets to the browser.
- If conversion fails, mark only the optional conversion stage as failed and retain the previous working asset.

## Next work
1. Validate that Studio ZIP and JSON exports work in real browsers (including CDN failure fallback).
2. Create a format contract and isolated Kaggle converter experiment for textured GLB → Mesh2Splat output.
3. Prove compatible output and inspect the actual shader/material data before writing a FUMOCA viewer lighting adapter.
4. Add lighting UI only when it is bound to real renderer features, not cosmetic controls.
5. Review third-party licenses and dependency/model terms for commercial deployment.

## Provenance rule
Keep the source photos, generated views, reconstructed mesh, converted splat and relit render distinguishable in metadata. Synthetic content does not become a real observation, and uncalibrated dimensions are not measurement-grade.
