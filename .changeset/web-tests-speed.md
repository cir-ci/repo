---
'@circi/web': patch
---

The dashboard's tests are faster on CI: 242 s instead of 441 s, which brings the gate's test half from 8m02s to 5m33s. Most of that comes from running two workers there instead of one. The gate had spent its last minutes waiting on web's tests alone, and the memory a single worker used to protect is free now that the test databases live on a Postgres server. Two tests no longer wait out a timeout. In Shell, opening a project page recorded the workspace as last opened through a request the test hadn't faked. Its "not found" toast covered the phone-sized menu for 10 seconds, and the next click waited it out. In Accounts, a check for the "Copied" toast also matched the copy button, which reads "Copied" too, so it ran until its 5-second timeout.
