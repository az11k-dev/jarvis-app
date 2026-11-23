#!/usr/bin/env bash
# Sets up laptop/server control. Safe to run again (updates the code, keeps tokens).
#
#   remote/setup.sh [ssh-host] [domain]     defaults: my-server jarvis.react.uz
#
# 1. tokens: made once, kept in ~/.config/jarvis-agent/env (laptop) and the app's .env (phone)
# 2. server: relay in /opt/jarvis-relay, systemd unit, nginx site + Let's Encrypt cert
# 3. laptop: agent in ~/.local/share/jarvis-agent, systemd user unit
set -euo pipefail

HOST="${1:-my-server}"
DOMAIN="${2:-jarvis.react.uz}"
HERE="$(cd "$(dirname "$0")" && pwd)"
APP_ENV="$HERE/../.env"
AGENT_DIR="$HOME/.config/jarvis-agent"
AGENT_ENV="$AGENT_DIR/env"
URL="https://$DOMAIN"

say() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }

# ── 1. tokens ──────────────────────────────────────────────────────────
mkdir -p "$AGENT_DIR"
chmod 700 "$AGENT_DIR"
if [[ ! -f "$AGENT_ENV" ]]; then
  say "Creating the laptop agent token"
  umask 077
  printf 'JARVIS_RELAY_URL=%s\nJARVIS_AGENT_TOKEN=%s\n' "$URL" "$(openssl rand -hex 32)" > "$AGENT_ENV"
fi
AGENT_TOKEN="$(grep -oP '^JARVIS_AGENT_TOKEN=\K.*' "$AGENT_ENV")"

touch "$APP_ENV"
chmod 600 "$APP_ENV" # holds the phone token
PHONE_TOKEN="$(grep -oP '^EXPO_PUBLIC_JARVIS_REMOTE_TOKEN=\K.+' "$APP_ENV" || true)"
if [[ -z "$PHONE_TOKEN" ]]; then
  say "Creating the phone token (in .env)"
  PHONE_TOKEN="$(openssl rand -hex 32)"
  sed -i '/^EXPO_PUBLIC_JARVIS_REMOTE_\(URL\|TOKEN\)=/d' "$APP_ENV"
  printf '\n# Laptop and server control (remote/README.md)\nEXPO_PUBLIC_JARVIS_REMOTE_URL=%s\nEXPO_PUBLIC_JARVIS_REMOTE_TOKEN=%s\n' "$URL" "$PHONE_TOKEN" >> "$APP_ENV"
fi

# ── 2. server ──────────────────────────────────────────────────────────
say "Deploying the relay to $HOST"
ssh "$HOST" 'mkdir -p /opt/jarvis-relay/relay /opt/jarvis-relay/lib'
scp -q "$HERE/relay/relay.mjs" "$HOST:/opt/jarvis-relay/relay/"
scp -q "$HERE/lib/run.mjs" "$HOST:/opt/jarvis-relay/lib/"
scp -q "$HERE/deploy/jarvis-relay.service" "$HOST:/etc/systemd/system/"
printf 'JARVIS_PHONE_TOKEN=%s\nJARVIS_AGENT_TOKEN=%s\nPORT=3020\nHOST=127.0.0.1\n' "$PHONE_TOKEN" "$AGENT_TOKEN" |
  ssh "$HOST" 'umask 077 && cat > /etc/jarvis-relay.env'
ssh "$HOST" 'systemctl daemon-reload && systemctl enable --quiet jarvis-relay && systemctl restart jarvis-relay'

say "nginx site $DOMAIN"
sed "s/jarvis\.react\.uz/$DOMAIN/g" "$HERE/deploy/nginx-jarvis.react.uz.conf" | ssh "$HOST" "cat > /tmp/jarvis-site.conf"
sed "s/jarvis\.react\.uz/$DOMAIN/g" "$HERE/deploy/nginx-jarvis-bootstrap.conf" | ssh "$HOST" "cat > /tmp/jarvis-bootstrap.conf"
ssh "$HOST" bash -s -- "$DOMAIN" <<'REMOTE'
set -euo pipefail
DOMAIN="$1"
SITE="/etc/nginx/sites-available/$DOMAIN"
if [[ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
  cp /tmp/jarvis-bootstrap.conf "$SITE"
  ln -sf "$SITE" "/etc/nginx/sites-enabled/$DOMAIN"
  nginx -t -q && systemctl reload nginx
  mkdir -p /var/www/html
  certbot certonly --webroot -w /var/www/html -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring -q
fi
cp /tmp/jarvis-site.conf "$SITE"
ln -sf "$SITE" "/etc/nginx/sites-enabled/$DOMAIN"
rm -f /tmp/jarvis-site.conf /tmp/jarvis-bootstrap.conf
nginx -t -q && systemctl reload nginx
REMOTE

# ── 3. laptop ──────────────────────────────────────────────────────────
say "Installing the laptop agent"
DEST="$HOME/.local/share/jarvis-agent"
mkdir -p "$DEST/agent" "$DEST/lib" "$HOME/.config/systemd/user"
cp "$HERE/agent/laptop-agent.mjs" "$DEST/agent/"
cp "$HERE/lib/run.mjs" "$DEST/lib/"
ln -sf "$(command -v node)" "$DEST/node" # systemd doesn't see nvm's PATH
cp "$HERE/deploy/jarvis-agent.service" "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --quiet jarvis-agent
systemctl --user restart jarvis-agent

say "Checking"
sleep 3
curl -fsS "$URL/v1/health" >/dev/null && echo "relay: up at $URL"
curl -fsS -H "authorization: Bearer $PHONE_TOKEN" "$URL/v1/status"
echo
