---
'@circi/testing': patch
---

The fake CirCI API server the CLI's tests used (`FakeCirci`) is now in `@circi/testing/hosts`, so the integrations' tests share it, with an `outcome` option, `uploads()` and `json(method, path)`.
