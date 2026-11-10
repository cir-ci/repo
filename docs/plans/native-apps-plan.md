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

1. `apps/desktop`: a Tauri 2 project. First launch asks for a server address, checks
   `/api/health`, remembers it; more servers can be added and switched between from the app menu.
2. The window loads the server's dashboard with `decorations: false` (Windows, Linux) or the macOS
   overlay title bar. The dashboard detects the app (a user-agent token or an injected flag) and
   shows its title bar strip, with the tabs, as it does in window-controls-overlay mode, plus our own
   window buttons on Windows and Linux (the `WindowTitleBar` and `--circi-window-top` work carries over).
3. Tabs: the in-app tabs already built for the installed web app, enabled in the desktop app too.
4. Background notifications: the menu bar or tray presence (on by default), start at login (off by
   default, a setting), a connection to each added server, OS notifications and the dock or taskbar
   badge from the inbox; a `circi://` deep link opens a build in the app.
5. Auto-update (Tauri's updater, from GitHub releases). Signing and notarisation for macOS and
   signing for Windows come later; the first builds are unsigned.
6. CI: build the three targets on release tags.
7. Tests: add a WebKit project to Vitest browser mode and Playwright, since macOS renders the
   dashboard in WebKit.

## Decisions (2026-11-10)

- **Background:** closing the window keeps the app in the menu bar or system tray, so notifications
  keep arriving. It doesn't start at login unless turned on in its settings.
- **Servers:** a list. Several server addresses can be added and switched between from the app
  menu; notifications come from each.
- **Updates:** published to the project's GitHub releases (once there is a remote repository); the
  updater reads its manifest from there.
- **Signing:** later. The first builds are unsigned, for internal use (macOS and Windows warn on
  install); signing comes once the Apple Developer and Windows certificates are in place.

## Effort

About 3 to 5 days of work, most of it in parallel: the window and server address (hours), the title
bar and tabs (half a day to a day), tray, notifications and badge (a day), deep links (hours), the
updater (half a day), CI for three platforms (half a day to a day, needs the remote repository),
WebKit tests (half a day plus fixes). Signing waits on the accounts, not on work. Only macOS can be
tried by hand here; Windows and Linux are checked in CI.

## Phones: TBD

Not planned yet; the installed web app covers phones for now. Notes for when it comes up:

- iPhone: the installed web app already receives web push from the user's server (iOS 16.4 and
  later). A native App Store app would need a push relay we run, since Apple's push service takes
  only our key.
- Android: a store app could get notifications from the user's server through UnifiedPush (a
  distributor such as ntfy) with no relay. Capacitor is the likely tool.
