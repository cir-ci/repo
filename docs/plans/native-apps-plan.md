# Native apps: plan

Status: planned, not started (2026-11-10). The installed web app (PWA) with web push, a phone layout
and in-app tabs is built; this plan is for when that isn't enough.

## Why

The installed web app can't own its whole title bar. Even in window-controls-overlay mode Chrome
keeps its own app menu (⋮) and, outside that mode, the extension and app icons. A desktop wrapper
draws the entire window: our tab strip can sit at the very top, with nothing of the browser's.
Phones would gain store listings and native push, at a cost (below).

## The choice

| | Desktop | iOS / Android | Notes |
|---|---|---|---|
| **Tauri 2** | macOS, Windows, Linux (system webview: WebKit, WebView2, WebKitGTK) | Yes since 2.0 (Oct 2024), younger | Small app (a few MB), Rust shell; full control of the window (`decorations: false` plus our drag region, or macOS `titleBarStyle: overlay` keeping the traffic lights) |
| **Capacitor** | Only through the community Electron plugin, which lags | Mature, the most used | Best mobile story; no first-party desktop |
| **Electron** | All three, Chromium everywhere | No | Large app (~100 MB), but one engine, so what we test is what ships |

**Recommendation:** Tauri 2 for the desktop app, notifying from a background connection to the
user's server. Keep iPhone on the installed web app (web push from the server works there). For
Android, the installed web app too, or a Capacitor app with UnifiedPush if a store listing is wanted. All of
them wrap the same `apps/web` build or the server's own address, so the dashboard stays one
codebase.

Electron is the fallback if WebKit on macOS (Tauri's engine there) shows rendering differences we
can't fix; today every test runs in Chromium only.

## How the app talks to the server (self-hosted)

Every install is someone's own server, so the app asks for the server's address on first launch
(and keeps a list, to switch between servers).

- **Load the server's own dashboard in the window** (the address the user gave). Cookies and
  sign-in work as in the browser (same origin), updates arrive with the server, and SSO/OIDC
  redirects work unchanged. This is the plan for desktop.
- The alternative, bundling the dashboard in the app and calling the server cross-origin, needs
  bearer tokens instead of cookies (WebKit blocks third-party cookies) and a sign-in flow through
  the system browser with a deep-link back. Only worth it for an app store build that must work
  offline or pass review (Apple guideline 4.2 rejects apps that are only a website).

## Notifications: straight from the user's server

The server can always notify the app; what matters is what wakes the app once it is closed. A
closed native app can only be woken by its platform's push service (Apple's APNs, Google's FCM),
which accepts messages signed with the publisher's key: ours. Giving that key to every
self-hosted server would let any of them reach everyone's devices, so native push would need a
relay that we run. Each platform has a way around that:

- **Desktop wrapper (Tauri): stay connected.** The app keeps running in the menu bar or system tray
  when its window closes, starts at login, and holds a connection to the user's server (the inbox
  stream or a poll). It shows OS notifications and badges the dock or taskbar from there. Nothing
  of Apple's or Google's is involved; only quitting the app stops notifications.
- **Android: UnifiedPush.** An open standard for exactly this: the user's server sends to a
  distributor app on the phone (ntfy, which can itself be self-hosted), which wakes our app, with
  no Google key. A foreground service holding a connection works too, at a battery cost.
- **iPhone: the installed web app.** Since iOS 16.4 a home-screen web app receives web push sent by
  the user's own server (already built). A native iPhone app is the one case that needs our
  relay, so iPhone stays on the installed web app.
- **Browsers and the installed web app:** web push from the server, as built.

## Desktop app (Tauri 2): steps

1. `apps/desktop`: a Tauri 2 project. First launch asks for the server address, checks
   `/api/health`, remembers it; a menu switches servers.
2. The window loads the server's dashboard with `decorations: false` (Windows, Linux) or the macOS
   overlay title bar. The dashboard detects the wrapper (a user-agent token or an injected flag) and
   shows its title bar strip, with the tabs, as it does in window-controls-overlay mode, plus our own
   window buttons on Windows and Linux (the `WindowTitleBar` and `--circi-window-top` work carries over).
3. Tabs: the in-app tabs already built for the installed app, enabled in the wrapper too.
4. Background notifications: the app stays in the menu bar or tray when its window closes (and can
   start at login), keeps a connection to the server, and shows OS notifications and a dock or
   taskbar badge from the inbox; a `circi://` deep link opens a build in the app.
5. Auto-update (Tauri's updater), signing and notarisation for macOS, signing for Windows.
6. CI: build the three targets on release tags.
7. Tests: add a WebKit project to Vitest browser mode and Playwright, since macOS renders the
   dashboard in WebKit.

Rough size: 1 to 2 weeks for the app, plus the time to get signing certificates.

## Phone apps (Capacitor), if needed later

1. Android: `apps/mobile`, Capacitor, loading the server's dashboard; notifications through
   UnifiedPush (the server gains a UnifiedPush sender beside web push).
2. iPhone: only if a store listing is a must. It needs our push relay (a service we would run),
   since APNs takes only our key.
3. Store listings, review, and enterprise distribution for companies that self-host.

## Open questions

- Desktop: should the app stay in the menu bar or tray and start at login by default, or only when
  turned on?
- Android: is a store app with UnifiedPush wanted, or is the installed web app enough?
- iPhone: is a store listing worth running a push relay for, or does the installed web app do?
- Which server addresses to support: one per app install, or a list to switch between?
