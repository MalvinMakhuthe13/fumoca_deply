# FUMOCA clean NIF — paste these cells into a new Kaggle notebook.
# Settings: GPU T4. Secrets: SUPABASE_URL, SUPABASE_SECRET_KEY, CF_ACCOUNT_ID,
#   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
#
# What this does, and what it refuses to do:
#   - does not upgrade numpy or Pillow (that pairing is what killed the last runs)
#   - installs COLMAP if apt can, and if it cannot, the job still finishes
#   - a full video keeps a frame every ~4° of turn, and a sideways slide, up to 120 views
#   - if COLMAP is missing, camera angles are measured from those frames
#   - a guessed circle is only used when the frames themselves will not match
#   - the NIF is written either way. If poses are an orbit, the log says so.

CELL_1 = r'''
import os
from kaggle_secrets import UserSecretsClient
s = UserSecretsClient()
os.environ["SUPABASE_URL"] = s.get_secret("SUPABASE_URL")
os.environ["SUPABASE_SECRET_KEY"] = s.get_secret("SUPABASE_SECRET_KEY")
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = os.environ["SUPABASE_SECRET_KEY"]
os.environ["CF_ACCOUNT_ID"] = s.get_secret("CF_ACCOUNT_ID")
os.environ["ACCOUNT_ID"] = os.environ["CF_ACCOUNT_ID"]
os.environ["R2_ACCESS_KEY_ID"] = s.get_secret("R2_ACCESS_KEY_ID")
os.environ["R2_SECRET_ACCESS_KEY"] = s.get_secret("R2_SECRET_ACCESS_KEY")
os.environ["QT_QPA_PLATFORM"] = "offscreen"
os.environ.setdefault("FUMOCA_ANGLE_FILL", "auto")
missing = [k for k in ("SUPABASE_URL", "SUPABASE_SECRET_KEY", "CF_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY") if not os.environ.get(k)]
print("OK" if not missing else "MISSING " + ", ".join(missing))
'''

CELL_2 = r'''
import os
if not os.path.isdir("/kaggle/working/fumoca"):
    !git clone --depth 1 https://github.com/MalvinMakhuthe13/fumoca_deply.git /kaggle/working/fumoca
%cd /kaggle/working/fumoca/kaggle
'''

CELL_3 = r'''
%run kaggle_nif_bootstrap.py
'''

CELL_4 = r'''
import fumoca_nif_worker
fumoca_nif_worker.main()
'''

if __name__ == "__main__":
    print("Paste CELL_1, CELL_2, CELL_3, CELL_4 into a GPU notebook, in that order.")
    print("A surviving job logs either 'poses estimated via COLMAP' or 'orbit fallback, job continues', then a NIF upload.")
