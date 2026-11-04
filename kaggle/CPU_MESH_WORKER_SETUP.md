# FUMOCA CPU Mesh Worker

This worker reconstructs a mesh from Gaussian geometry that already exists in
Studio. It does **not** create/train Gaussians and does not require a GPU.

## One-time Supabase setup

Run `supabase_migration_cpu_mesh_worker.sql` in the Supabase SQL editor for
`fumoca-production`. It adds the atomic `claim_next_mesh_only_job()` RPC.
The function only claims `queued` rows whose `capture_mode` is
`mesh_only`; it cannot consume full video/photo reconstruction jobs.

## Kaggle CPU notebook

A ready-to-run notebook is included at `kaggle/FUMOCA_CPU_Mesh_Worker.ipynb`. Upload/import it into Kaggle, or follow the manual steps below.

1. Create/open a Kaggle notebook.
2. In Notebook options, set **Accelerator: None** (do not enable GPU).
3. Add these five values as Kaggle secrets:
   - `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY` (service-role secret; never put it in browser code)
   - `CF_ACCOUNT_ID`
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
4. In a notebook cell, clone the repository:

   ```bash
   !git clone https://github.com/MalvinMakhuthe13/fumoca_deply.git
   %cd fumoca_deply
   ```

5. Install only the mesh dependencies:

   ```bash
   pip install -r engine-next/reconstruction/requirements-mesh-only.txt
   ```

6. Load Kaggle secrets into the notebook process, then start the worker:

   ```python
   import os
   from kaggle_secrets import UserSecretsClient

   secrets = UserSecretsClient()
   for name in (
       "SUPABASE_URL", "SUPABASE_SECRET_KEY", "CF_ACCOUNT_ID",
       "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
   ):
       os.environ[name] = secrets.get_secret(name)
   ```

   ```bash
   !python kaggle/fumoca_cpu_mesh_worker.py
   ```

Keep the notebook session running while Studio jobs are processed. The worker
polls only mesh-only jobs. It does not claim ordinary video/photo capture jobs.

## What happens

Studio uploads the current live Gaussian geometry to the `nif-files` bucket,
then creates a `mesh_only` row in `reconstruction_jobs`. The CPU worker claims
that row atomically, runs oriented Gaussian surfel normal estimation and
confidence-weighted TSDF/marching-cubes extraction, and uploads the resulting
NIF mesh/components and STL. The original Gaussian layer is not modified.

## Limits and honest expectations

- CPU processing can take several minutes for a large scene; runtime depends on
  point count, spatial extent and available RAM.
- This path does not run COLMAP, neural depth, SAM, deblurring or Gaussian
  training.
- It cannot reconstruct surfaces that were never observed in the source scan.
- Watertightness is measured and reported; it is never assumed.
- Scene-scale output preserves the original coordinates. It is not a metric
  measurement unless the source itself has valid calibration.
- The worker is not an always-on service: Kaggle must remain running. This is
  a free CPU option, not a paid GPU service.
