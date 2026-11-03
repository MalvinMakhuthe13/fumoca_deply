# Oriented-Surfel Full-Scene QA Protocol

This protocol validates the full reconstruction workflow, not only a single selected object. Keep the original Gaussian layer unchanged and reconstruct the complete live scene.

## Required test captures

1. **Object on a support platform** — e.g. the cap on its wooden display. Capture the full object and the complete visible platform, including the exposed platform perimeter.
2. **Two nearby independent objects** — leave a visible gap between them; include a second case where the objects touch if possible.
3. **Thin feature** — include a narrow rim, tab, handle, lip or thin wall.
4. **Concave geometry** — include an L-shaped corner, recess, cavity or inward-facing surface.
5. **Open scan boundary** — deliberately leave one region uncaptured so genuine openings can be distinguished from repairable gaps.

## Studio procedure

1. Load the complete Gaussian scene.
2. Use **Select All** only if you need the complete scene selection for a later selected-only extraction. The **Reconstruct full scene · oriented surfels** action is already intended to use all live points; it does not require selecting only the cap.
3. Open Mesh & Print and run **Reconstruct full scene · oriented surfels**.
4. Keep both the original Gaussian layer and reconstructed mesh visible for comparison.
5. Inspect each component using its visibility checkbox, Select and Isolate controls.
6. Review the support-plane suggestion and confidence. Check the suggested Y coordinate against the visible platform before using **Split selected**. Do not split automatically if the suggested plane intersects the object.
7. Inspect the mesh with the original splats hidden, then restore the splats and compare.
8. Save/export the NIF, reload it, and verify that component IDs, visibility, transforms, support role, topology diagnostics and support-plane suggestion survive the round trip.
9. Open the same published NIF in the public viewer and verify the component visibility controls and support-plane review hint.

## Acceptance criteria

- The original Gaussian positions, scales, rotations, colors and opacity remain unchanged by reconstruction.
- The mesh and Gaussian layers can be shown/hidden independently.
- Each disconnected reconstructed mesh component has independent visibility, selection, isolation, transform and deletion.
- A support plane is retained as geometry. Detection only suggests a split; no component is deleted automatically.
- A user-confirmed plane split produces two independently addressable surfaces and reports the actual open-edge/non-manifold counts.
- Nearby independent objects do not gain a phantom bridge across unsupported space.
- Thin features do not collapse into a false middle surface.
- Concave observed surfaces remain represented; unsupported cavities are not force-filled.
- Genuine open boundaries remain open unless an explicit, evidence-gated repair passes its support checks.
- Diagnostics report component count, triangle count, TSDF coverage, mean surfel confidence, open edges, non-manifold edges, watertightness and repair decisions.
- NIF reload preserves component identities and metadata; public viewer renders the same components and colors.

## Do not accept

- A cloudy translucent shell that only looks complete while the splats are visible.
- A support platform merged into the object without a usable way to isolate it.
- Two objects fused across an unsupported gap.
- A filled hole with no observed interior support.
- A watertight/print-ready claim based only on successful STL export.
- A visually plausible mesh whose dimensions are treated as metric without calibration.

## Current automated coverage and remaining manual validation

The automated worker tests cover normal orientation, confidence-weighted TSDF support, nearby separated objects, thin parallel features, a concave L-shaped corner, support-plane suggestions, evidence-gated boundary repair, invalid Gaussian rows, NIF component round trips and split-boundary diagnostics.

These tests validate helper behavior and file contracts. They do **not** replace testing the actual trained cap/platform capture in the deployed Studio and public viewer. Record the capture used, the component count, TSDF coverage, confidence, open/non-manifold edge counts, and screenshots from all sides before approving the reconstruction.
