# Laptop and server control

JARVIS controls the laptop (Pop!_OS, GNOME on X11) and the server from anywhere:

```
Phone (JARVIS) ──HTTPS──▶ jarvis.react.uz ── relay on the server (nginx → 127.0.0.1:3020)
                                │   ▲
         target "server": runs  │   └── laptop agent long-polls over HTTPS (outgoing only)
         here as root           ▼
                         laptop agent (systemd user service) → runs as the user
```

- `relay/relay.mjs`: the gateway, plus JARVIS's hands on the server. Zero dependencies.
- `agent/laptop-agent.mjs`: runs jobs on the laptop: apps (`.desktop` entries via
  `gtk-launch`), windows (`xprop`/`xdotool`), volume (`pactl`), media (MPRIS via `gdbus`),
  typing and keys (`xdotool`), lock, suspend, screenshots (ImageMagick `import`),
  notifications, and any bash command. It needs no open port and works on any network.
- `lib/run.mjs`: the bash runner shared by both (time limit, kills the process group).
- Phone side: `src/services/remote.js` (tools `laptop_control`, `laptop_screen`,
  `laptop_shell`, `server_shell`, `server_status`, `remote_confirm`).

## Security

- Two bearer tokens (256-bit): the **phone token** (`EXPO_PUBLIC_JARVIS_REMOTE_TOKEN`
  in `.env`, built into the app) may run anything on both machines; the **agent token**
  (`~/.config/jarvis-agent/env`) may only fetch laptop jobs and post their results.
  The relay keeps both in `/etc/jarvis-relay.env` (mode 600).
- TLS through Cloudflare to nginx (Let's Encrypt). The relay itself listens only on
  127.0.0.1. Ten failed logins from one IP lock that IP out for ten minutes.
- Every command is logged: server `journalctl -u jarvis-relay`, laptop
  `journalctl --user -u jarvis-agent`.
- Shell commands that delete, kill, stop, restart, shut down or use sudo run only after
  JARVIS says what will happen and the user answers yes in the next turn
  (`riskOf` in `src/services/remoteFormat.js`; enforced in code, not in the prompt).
  This guards against misheard commands, not against attackers.
- Anyone with the app's APK can extract the phone token. If the phone is lost, rotate it
  (below).

## Setup / update

```sh
remote/setup.sh [ssh-host] [domain]   # defaults: my-server jarvis.react.uz
```

It creates the tokens once, deploys the relay (`/opt/jarvis-relay`,
`jarvis-relay.service`, nginx site and certificate), installs the agent
(`~/.local/share/jarvis-agent`, `jarvis-agent.service`) and checks the connection.
Run it again after changing anything in `remote/`. The domain needs a DNS A record to
the server first. Rebuild or reload the app after the first run: the token is read from
`.env` at bundle time.

**Rotate the tokens:** delete `~/.config/jarvis-agent/env` and the
`EXPO_PUBLIC_JARVIS_REMOTE_*` lines in `.env`, run `remote/setup.sh`, then rebuild the app.

## Troubleshooting

```sh
curl https://jarvis.react.uz/v1/health                    # relay up?
systemctl --user status jarvis-agent                      # laptop agent
journalctl --user -u jarvis-agent -n 30
ssh my-server journalctl -u jarvis-relay -n 30
```

- `laptop_offline`: the laptop is asleep, off or offline. The agent reconnects by itself
  after waking.
- Shell commands stop after 85 s (Cloudflare cuts requests at 100 s). Run longer jobs
  with `nohup … > /tmp/job.log 2>&1 &` and check the log.
- `sudo` on the laptop needs a password, so it doesn't work from JARVIS.
- If Node is upgraded with nvm, run `remote/setup.sh` again (the agent uses a symlink to
  the current `node`).
