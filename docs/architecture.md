# React desktop architecture

## Runtime boundaries

| Area | Responsibility |
| --- | --- |
| `src/main` | Electron windows, SQLite file lifecycle, file dialogs, media import and LAN signaling |
| `src/preload` | Narrow, typed IPC surface; renderer has no Node.js integration |
| `src/renderer/src` | React screens, Tailwind styling, board composition and WebRTC publishing |
| `src/renderer/public/reader` | Static view-only LAN player, served only while broadcast is started |
| `src/shared` | Data and IPC API types shared between the renderer and preload |

The main process owns the active database and chooses a database path from
`dados/active-db.txt`. Room and app preferences are stored in the original
SQLite `settings` table. Documents retain the existing versioned keys and JSON
formats to avoid migrating the copied database.

## Public output

The editor renders a fixed 1920 x 1080 canvas. The audience view omits hidden
tokens and renders fog as opaque. Private sheets and GM notes do not enter the
board model. A separate Electron window reads the same room document and renders
the public composition. Like the Java application, it opens as a 960 x 540
window on the selected display, can be toggled to fullscreen with F11, and stays
above the Studio while open. Closing the audience window hides it; leaving the
room closes it. The Studio overview shows only map layers and the current
viewport, while the adjacent public preview shows the audience composition.

Broadcast starts an HTTP/WebSocket listener on the chosen port. A random
per-start secret authorizes the host publisher; viewer signaling is restricted
to the active host connection. The host creates a WebRTC peer per viewer and
sends a canvas composition of the public board, including its visibility,
viewport, blackout, and cinematic state, plus a mixed audio track from the
Studio media players. Online cinematic video can only be included in that
composition when its host permits cross-origin capture (CORS). The static
reader only receives and plays the peer stream. No external ICE service is
configured.

## Persistence and recovery

The Java SQLite schema version 1 is preserved. SQLite work runs through the
WebAssembly `sql.js` runtime to avoid requiring a compiler/native addon on the
Windows development machine. Writes are exported to a temporary file and
renamed into place; backups are independently validated snapshots. Import copies
a valid database and leaves the source untouched.

Media imports are copied under the new project's `dados/media` directory.
Library removal only removes metadata, not the underlying file. Existing
absolute paths to media in the sibling Java project's `public` directory remain
readable while that folder exists.
