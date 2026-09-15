---
name: Expo static build port conflict
description: The mobile static build uses Metro on port 8081, which can conflict with the mockup preview workflow.
---

When building the JASIM mobile static Expo artifact, temporarily stop the mockup preview workflow if it owns Metro port 8081, then restart it immediately after the build.

**Why:** The mobile build script starts a non-interactive Expo/Metro process on its fixed default port. If the mockup server already owns that port, Expo prompts for a different port and the non-interactive build times out.

**How to apply:** This is only needed for a mobile production build while the mockup preview server is active. It is not required for the normal Expo development workflow.