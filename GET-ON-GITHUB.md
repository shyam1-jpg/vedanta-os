# Push this folder as its own private GitHub repo

This repository is not deployed by this change. When Shyam chooses to go live, staff sign in with Microsoft 365. There is no email-only staff sign-in.

---

Render’s Blueprint expects `render.yaml` at the **repository root**. This folder is that root.

```
cd vedanta-platform
git init
git add -A
git commit -m "Vedanta platform"
git branch -M main
git remote add origin https://github.com/<your-username>/vedanta-platform.git
git push -u origin main
```

Then on render.com: **New → Blueprint → vedanta-platform → Apply**.

Already have this code on the `parslia-kitchen-os` repo? Apply `vedanta-platform/render.monorepo.yaml` instead (same three services; paths are prefixed).
