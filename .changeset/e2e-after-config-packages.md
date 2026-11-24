---
'@circi/e2e': patch
'@circi/ui': patch
'@circi/vitest-config': patch
---

The end-to-end checks that broke when each package got its own Vitest config work again. The Compose smoke test runs @circi/storage's live tests from that package's folder. The visual run (`pnpm test:visual`) receives the `CIRCI_*` settings through Turborepo again, and its uploader looks for the captures at the repository root, where the visual project writes them, so the design system's screenshots upload again.
