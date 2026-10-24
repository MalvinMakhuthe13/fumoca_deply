# FUMOCA Quick Splat — Kaggle notebook cell guide
# GPU on · attach secrets: SUPABASE_URL, SUPABASE_SECRET_KEY, CF_ACCOUNT_ID,
#   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
#
# Pipeline: Upload video → Quick Splat → .ply on R2 → Studio clean → NIF later
# ---------------------------------------------------------------------------

# === Cell 1 — secrets + lean limits ===
CELL_1 = r'''
import os
from kaggle_secrets import UserSecretsClient
s = UserSecretsClient()
os.environ["SUPABASE_URL"] = s.get_secret("SUPABASE_URL")
os.environ["SUPABASE_SECRET_KEY"] = s.get_secret("SUPABASE_SECRET_KEY")
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = s.get_secret("SUPABASE_SECRET_KEY")
os.environ["CF_ACCOUNT_ID"] = s.get_secret("CF_ACCOUNT_ID")
os.environ["ACCOUNT_ID"] = s.get_secret("CF_ACCOUNT_ID")
os.environ["R2_ACCESS_KEY_ID"] = s.get_secret("R2_ACCESS_KEY_ID")
os.environ["R2_SECRET_ACCESS_KEY"] = s.get_secret("R2_SECRET_ACCESS_KEY")

os.environ["FUMOCA_QUICK_SPLAT"] = "1"
os.environ["FUMOCA_MAX_RECON_FRAMES"] = "36"
os.environ["FUMOCA_GS_ITERS"] = "200"
os.environ["FUMOCA_QUICK_MAX_SIDE"] = "640"
print("secrets OK")
'''

# === Cell 2 — repo ===
CELL_2 = r'''
import os
if not os.path.isdir("/kaggle/working/fumoca"):
    !git clone --depth 1 https://github.com/MalvinMakhuthe13/fumoca_deply.git /kaggle/working/fumoca
%cd /kaggle/working/fumoca/kaggle
'''

# === Cell 3 — lean bootstrap (no rembg/SAM required for Quick path) ===
CELL_3 = r'''
import subprocess, sys
pkgs = ["boto3", "botocore", "requests", "supabase", "httpx==0.28.1"]
# Do not pip install numpy or Pillow here. Upgrading them on Kaggle breaks
# the image stack and the worker dies inside the mask.
for p in pkgs:
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", p], check=False)
print("lean bootstrap OK")
# Optional: still run full bootstrap if you want both paths available
# %run kaggle_nif_bootstrap.py
'''

# === Cell 4 — install Quick Splat route ===
CELL_4 = r'''
import sys
sys.path.insert(0, "/kaggle/working/fumoca/kaggle")
import fumoca_quick_splat
fumoca_quick_splat.install_quick_splat_route()
'''

# === Cell 5 — re-queue job as splat_only ===
CELL_5 = r'''
from supabase import create_client
import os
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SECRET_KEY"])
JOB_ID = "PASTE-YOUR-JOB-UUID-HERE"
sb.table("reconstruction_jobs").update({
    "status": "queued",
    "progress": 0,
    "capture_mode": "splat_only",
    "error_message": None,
}).eq("id", JOB_ID).execute()
print("queued splat_only", JOB_ID)
'''

# === Cell 6 — run (poll loop) ===
CELL_6 = r'''
import fumoca_nif_worker
fumoca_nif_worker.main()
'''

# === Alternative: one-shot without poll ===
CELL_6_ONESHOT = r'''
import fumoca_quick_splat
JOB_ID = "PASTE-YOUR-JOB-UUID-HERE"
print(fumoca_quick_splat.process_job_id(JOB_ID))
'''

if __name__ == "__main__":
    print("FUMOCA Quick Splat notebook cells — copy CELL_1 … CELL_6 into Kaggle")
    print("Success log should include: [QUICK] mode=ON … [QUICK] DONE")
