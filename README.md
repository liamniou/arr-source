# Arr Source (Chrome extension)

Adds a `Source: …` line to every poster in Radarr/Sonarr (and to the movie/series detail page):

- `Source: Overseerr (user)` – an Overseerr request exists for the item on this Radarr/Sonarr instance (`, auto` = auto-request)
- `Source: List (name, …)` – Radarr only: the movie is in one or more import lists (best guess; Radarr doesn't record who added it)
- `Source: Direct / list` – Sonarr with import lists configured (Sonarr doesn't expose list membership)
- `Source: Direct` – none of the above

Hover the line for details.

<img width="1278" height="623" alt="image" src="https://github.com/user-attachments/assets/4038a850-3be2-4810-8250-36b8f57e0073" />

## Install

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → select this folder.
2. Open the extension's options and fill in:
   - instances, one per line (e.g. `http://192.168.0.237:7878`, `http://192.168.0.237:8989`)
   - Overseerr URL and API key (Settings → General in Overseerr; stored in the browser's local extension storage only)
3. Reload the Radarr/Sonarr tabs.

The Radarr/Sonarr API key is read from the logged-in UI (`/initialize.json`), so it isn't needed in the options.
