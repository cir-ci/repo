// The first script: the token variables and the loading screen's styles, in a module with no
// other imports, so the loading screen in index.html is styled at once (in development too, where
// the app's own module graph takes a while to load). main.tsx draws the app over it.
// oxlint-disable-next-line import/no-unassigned-import
import '@circi/ui/global.css'
// oxlint-disable-next-line import/no-unassigned-import
import './boot.css'
