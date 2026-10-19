# FUMOCA — clean run for a FULL editable PLY (COLMAP dense)
# GPU recommended · Python deps are light (no graphdeco CUDA compile)
#
# Pipeline:
#   video → frames → COLMAP → patch_match_stereo → fused.ply → R2 → Studio
#
# Cell 1 — secrets
CELL_1 = r'''
import os
from kaggle_secrets import UserSecretsClient
s = UserSecretsClient()
for k in ["SUPABASE_URL","SUPABASE_SECRET_KEY","CF_ACCOUNT_ID","R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY"]:
    os.environ[k] = s.get_secret(k)
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = os.environ["SUPABASE_SECRET_KEY"]
os.environ["ACCOUNT_ID"] = os.environ["CF_ACCOUNT_ID"]
os.environ["FUMOCA_QUICK_SPLAT"] = "1"
os.environ["FUMOCA_MAX_RECON_FRAMES"] = "48"
os.environ["FUMOCA_QUICK_MAX_SIDE"] = "960"
os.environ["FUMOCA_TRY_GS_TRAIN"] = "0"   # dense COLMAP only — clean, no CUDA build errors
os.environ["COLMAP_BIN"] = "/usr/bin/colmap"
os.environ["FUMOCA_COLMAP_GPU"] = "0"
print("secrets OK")
'''

# Cell 2 — system deps once
CELL_2 = r'''
import os
os.chdir("/kaggle/working")
!apt-get update -qq && apt-get install -y -qq colmap > /dev/null
!which colmap && colmap -h | head -2
import subprocess, sys
subprocess.run([sys.executable,"-m","pip","install","-q","boto3","botocore","Pillow","numpy","supabase","httpx==0.28.1"], check=False)
print("deps OK")
'''

# Cell 3 — fresh code + run
CELL_3 = r'''
import os, shutil, sys
os.chdir("/kaggle/working")
for k in list(sys.modules):
    if "fumoca_quick" in k:
        del sys.modules[k]
if os.path.isdir("/kaggle/working/fumoca"):
    shutil.rmtree("/kaggle/working/fumoca")
!git clone --depth 1 https://github.com/MalvinMakhuthe13/fumoca_deply.git /kaggle/working/fumoca
sys.path.insert(0, "/kaggle/working/fumoca/kaggle")
import fumoca_quick_splat
JOB_ID = "decd94e7-1b58-4f48-9037-001445b0d3f2"
print(fumoca_quick_splat.process_job_id(JOB_ID))
'''

# Cell 4 — download link helper
CELL_4 = r'''
# After DONE, use meta ply_url or:
from IPython.display import HTML, display
uid = "41808313-788d-4b08-9ae2-31e2036880fb"
jid = "decd94e7-1b58-4f48-9037-001445b0d3f2"
url = f"https://fumoca-r2.ntuthukochildofkrist.workers.dev/file/{uid}%2F{jid}%2Fpoint_cloud.ply?bucket=nif-files"
display(HTML(f'<a href="{url}" target="_blank">Download point_cloud.ply</a>'))
print(url)
'''

if __name__ == "__main__":
    print("Clean full PLY run — COLMAP dense, no graphdeco/gsplat compile")
