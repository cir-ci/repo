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

**Recommendation:** Tauri 2 for the desktop app. Keep phones on the installed web app, and add
Capacitor for iOS and Android only if store listings or native push become a requirement. All of
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

## Notifications: the catch

Web push, which each server sends itself, works in browsers and the installed web app. **It does
not work inside Tauri's or Capacitor's webviews** (WebKit's WKWebView and Android's WebView have no
Push API), and Electron has none either.

- **Desktop wrapper:** while the app is running, the dashboard already knows about new
  notifications (it polls the inbox); show them as OS notifications through the wrapper's
  notification API, and badge the dock icon with the unread count. No push when the app is closed;
  the installed web app stays the way to get push with the app closed.
- **Phone wrapper (Capacitor):** native push needs Apple's and Google's keys, which can't be given
  to every self-hosted server. It means running a push relay that servers send to and that holds
  the keys (as Mattermost and Rocket.Chat do), a service we would operate. This is the main reason
  phones stay on the installed web app for now.

## Desktop app (Tauri 2): steps

1. `apps/desktop`: a Tauri 2 project. First launch asks for the server address, checks
   `/api/health`, remembers it; a menu switches servers.
2. The window loads the server's dashboard with `decorations: false` (Windows, Linux) or the macOS
   overlay title bar. The dashboard detects the wrapper (a user-agent token or an injected flag) and
   shows its title bar strip, with the tabs, as it does in window-controls-overlay mode, plus our own
   window buttons on Windows and Linux (the `WindowTitleBar` and `--circi-window-top` work carries over).
3. Tabs: the in-app tabs already built for the installed app, enabled in the wrapper too.
4. OS notifications and the dock or taskbar badge from the inbox count; a `circi://` deep link that
   opens a build in the app.
5. Auto-update (Tauri's updater), signing and notarisation for macOS, signing for Windows.
6. CI: build the three targets on release tags.
7. Tests: add a WebKit project to Vitest browser mode and Playwright, since macOS renders the
   dashboard in WebKit.

Rough size: 1 to 2 weeks for the app, plus the time to get signing certificates.

## Phone apps (Capacitor), if needed later

1. `apps/mobile`: Capacitor, loading the server's dashboard (or bundled, with bearer tokens, for the
   stores).
2. The push relay service, and the server sending to it when a person has a phone app device.
3. Store listings, review, and enterprise distribution for companies that self-host.

Rough size: weeks for the app, plus the relay as an ongoing service.

## Open questions

- Desktop: is losing push while the app is closed acceptable (the installed web app keeps it)?
- Phones: are store listings worth running a push relay for every self-hosted server?
- Which server addresses to support: one per app install, or a list to switch between?
