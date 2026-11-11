// The first script: the token variables, in a module with no other imports, so the loading screen
// in index.html gets its colours at once (in development too, where the app's own module graph takes
// a while to load). Its layout is boot.css, linked from index.html so it applies before any script.
// main.tsx draws the app over it.
// oxlint-disable-next-line import/no-unassigned-import
import '@circi/ui/global.css'
