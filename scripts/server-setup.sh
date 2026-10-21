#!/usr/bin/env bash
# Sets up the video workspace UI to run on a server and be opened from a phone or laptop.
#   scripts/server-setup.sh tailscale   # recommended: HTTPS on your tailnet, no open ports
#   scripts/server-setup.sh lan         # plain HTTP on every network interface (trusted networks only)
# Re-running is safe: it keeps an existing .env password and rewrites the service.
set -euo pipefail

mode="${1:-tailscale}"
case "$mode" in tailscale|lan) ;; *) echo "Usage: $0 [tailscale|lan]" >&2; exit 2 ;; esac
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
port="${PORT:-4310}"
cd "$repo"

say() { printf '\n== %s\n' "$*"; }
missing=()
need() { command -v "$1" >/dev/null 2>&1 || missing+=("$1 ($2)"); }

say "Checking prerequisites"
need node "Node 22 or newer"
need npm "comes with Node"
need ffmpeg "apt install ffmpeg"
need ffprobe "apt install ffmpeg"
need uv "curl -LsSf https://astral.sh/uv/install.sh | sh"
[ "$mode" = tailscale ] && need tailscale "https://tailscale.com/download/linux"
if ((${#missing[@]})); then printf 'Missing: %s\n' "${missing[@]}" >&2; exit 1; fi
node_major="$(node -p 'process.versions.node.split(".")[0]')"
if ((node_major < 22)); then echo "Node $node_major found; Node 22 or newer is required" >&2; exit 1; fi
clis=()
for cli in claude codex opencode pi; do command -v "$cli" >/dev/null 2>&1 && clis+=("$cli"); done
if ((${#clis[@]} == 0)); then
  echo "No agent CLI found (claude, codex, opencode or pi). Install one and sign in to it on this server first." >&2; exit 1
fi
echo "Agent CLIs: ${clis[*]} (each must already be signed in on this server)"

say "Installing dependencies"
npm ci --no-audit --no-fund

say "Writing .env"
touch .env && chmod 600 .env
set_env() { grep -q "^$1=" .env && sed -i "s|^$1=.*|$1=$2|" .env || echo "$1=$2" >> .env; }
if ! grep -q '^VG_UI_PASSWORD=.\{12,\}' .env; then
  set_env VG_UI_PASSWORD "$(node -e 'console.log(require("crypto").randomBytes(18).toString("base64url"))')"
  echo "Generated a new password."
fi
# Tailscale proxies HTTPS to loopback; LAN mode listens on every interface.
set_env VG_UI_HOST "$([ "$mode" = tailscale ] && echo 127.0.0.1 || echo 0.0.0.0)"
set_env PORT "$port"

say "Installing the systemd user service"
unit_dir="$HOME/.config/systemd/user"
mkdir -p "$unit_dir"
cat > "$unit_dir/video-gen-ui.service" <<EOF
[Unit]
Description=Video workspace UI ($repo)
After=network-online.target

[Service]
WorkingDirectory=$repo
# The agent CLIs are found on the PATH this script ran with.
Environment=PATH=$PATH
ExecStart=$(command -v node) $repo/ui/server.mjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable video-gen-ui.service >/dev/null
systemctl --user restart video-gen-ui.service
if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != yes ]; then
  loginctl enable-linger "$USER" 2>/dev/null || echo "Run 'sudo loginctl enable-linger $USER' so the service keeps running after you log out."
fi
sleep 2
systemctl --user --no-pager --lines=0 status video-gen-ui.service | head -3

if [ "$mode" = tailscale ]; then
  say "Publishing on your tailnet with HTTPS"
  if ! tailscale serve --bg "$port"; then
    echo "tailscale serve failed. Run 'sudo tailscale set --operator=$USER' once (or rerun this with sudo rights), then: tailscale serve --bg $port" >&2
  fi
  address="$(tailscale status --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log("https://"+JSON.parse(s).Self.DNSName.replace(/\.$/,""))}catch{}})')"
else
  address="$(hostname -I 2>/dev/null | awk '{print "http://"$1":'"$port"'"}')"
fi

say "Done"
echo "Open:     ${address:-see 'tailscale serve status'}"
echo "Password: $(grep '^VG_UI_PASSWORD=' .env | cut -d= -f2-)  (stored in $repo/.env)"
echo "Logs:     journalctl --user -u video-gen-ui -f"
