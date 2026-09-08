# Windows sideloading

The workflow `.github/workflows/ios-ipa.yml` builds an unsigned arm64 device IPA on a GitHub-hosted Mac. It runs only when manually dispatched, has read-only repository permissions, uses no Apple credentials and retains its artifact for seven days. It has been syntax-checked locally but has not yet run on GitHub.

## First prerequisite: GitHub authorization

GitHub CLI is installed in WSL at `/home/pickel/.local/bin/gh`. From Windows Terminal run:

```powershell
wsl -e /home/pickel/.local/bin/gh auth login --hostname github.com --git-protocol https --web --scopes workflow
```

Complete GitHub's browser authorization yourself. Do not paste passwords or tokens into chat.

Once authenticated, the remaining setup is to audit the complete upload including git history, create a PRIVATE repository, push the audited source and workflow, and dispatch the workflow. Do not upload desktop Nexus keys or account data. Private repository Actions usage depends on the account's allowance; do not enable paid usage without approval.

## After a successful cloud build

Download the `Nexus-unsigned-IPA` Actions artifact and extract `Nexus-unsigned.ipa`. This is deliberately unsigned and cannot install by tapping it on the phone. Sideloadly on Windows must sign it with your account and install it on your connected iPhone. Obtain Sideloadly and its current Windows prerequisites from https://sideloadly.io only. Enter Apple credentials directly into the tool yourself.

Trust the connected PC on the phone. Enable Developer Mode and trust the developer profile if iOS requests them. Free-account signing needs periodic refresh; check Sideloadly's current instructions for automatic refresh.

A cloud compile does not establish real-source networking, playback, file sharing or hardware layout. Those still require testing on the installed iPhone app.
