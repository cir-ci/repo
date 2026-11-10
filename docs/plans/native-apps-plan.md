# Native apps: plan

Status: planned, not started (2026-11-10). **Scope: the desktop app only.** Phones are TBD (see the
end); until then they use the installed web app (PWA), which has web push, a phone layout and
in-app tabs.

## Why

The installed web app can't own its whole title bar. Even in window-controls-overlay mode Chrome
keeps its own app menu (⋮) and, outside that mode, the extension and app icons. A desktop app draws
the entire window: our tab strip can sit at the very top, with nothing of the browser's.

## The choice

| | Desktop | Notes |
|---|---|---|
| **Tauri 2** | macOS, Windows, Linux (system webview: WebKit, WebView2, WebKitGTK) | Small app (a few MB), Rust shell; full control of the window (`decorations: false` plus our drag region, or macOS `titleBarStyle: overlay` keeping the traffic lights); menu bar and tray, autostart, notifications, updater |
| **Electron** | All three, Chromium everywhere | Large app (~100 MB), but one engine, so what we test is what ships |
| Capacitor | Only through the community Electron plugin, which lags | A mobile tool; not for the desktop |

**Recommendation:** Tauri 2. Electron is the fallback if WebKit on macOS (Tauri's engine there)
shows rendering differences we can't fix; today every test runs in Chromium only.

## How the app talks to the server (self-hosted)

Every install is someone's own server, so the app asks for the server's address on first launch.

The window loads **the server's own dashboard** (the address the user gave). Cookies and sign-in
work as in the browser (same origin), updates arrive with the server, and SSO/OIDC redirects work
unchanged. Nothing of the dashboard is bundled in the app.

## Notifications: straight from the user's server

A closed native app can only be woken by its platform's push service, which accepts only the
publisher's key, so the desktop app doesn't rely on it. Instead it **stays connected**: it keeps
running in the menu bar or system tray when its window closes, can start at login, holds a
connection to the user's server (the inbox stream or a poll), and shows OS notifications and a dock
or taskbar badge from there. Nothing of Apple's, Google's or ours is in between; only quitting the
app stops notifications.

## Steps

1. `apps/desktop`: a Tauri 2 project. First launch asks for the server address, checks
   `/api/health`, remembers it.
2. The window loads the server's dashboard with `decorations: false` (Windows, Linux) or the macOS
   overlay title bar. The dashboard detects the app (a user-agent token or an injected flag) and
   shows its title bar strip, with the tabs, as it does in window-controls-overlay mode, plus our own
   window buttons on Windows and Linux (the `WindowTitleBar` and `--circi-window-top` work carries over).
3. Tabs: the in-app tabs already built for the installed web app, enabled in the desktop app too.
4. Background notifications: the menu bar or tray presence, start at login, the server connection,
   OS notifications and the dock or taskbar badge from the inbox; a `circi://` deep link opens a
   build in the app.
5. Auto-update (Tauri's updater), signing and notarisation for macOS, signing for Windows.
6. CI: build the three targets on release tags.
7. Tests: add a WebKit project to Vitest browser mode and Playwright, since macOS renders the
   dashboard in WebKit.

Rough size: 1 to 2 weeks for the app, plus the time to get signing certificates.

## Open questions

- Should the app stay in the menu bar or tray and start at login by default, or only when turned on?
- One server per app install, or a list to switch between?

## Phones: TBD

Not planned yet; the installed web app covers phones for now. Notes for when it comes up:

- iPhone: the installed web app already receives web push from the user's server (iOS 16.4 and
  later). A native App Store app would need a push relay we run, since Apple's push service takes
  only our key.
- Android: a store app could get notifications from the user's server through UnifiedPush (a
  distributor such as ntfy) with no relay. Capacitor is the likely tool.
