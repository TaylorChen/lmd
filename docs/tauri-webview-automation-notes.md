# Tauri WebView Automation Notes

## Status

LMD currently uses two layers of automated verification:

- Rust unit/integration-style tests for real file flows
- Playwright browser tests with mocked Tauri command calls

This is intentional on macOS.

## Why There Is No Native Tauri WebDriver Suite Yet

Per the official Tauri v2 WebDriver documentation, desktop WebDriver automation is only supported on Windows and Linux. macOS desktop automation is not supported because there is no WKWebView WebDriver tool available for Tauri to build on.

That means the usual `tauri-driver` + Selenium/WebDriver flow is not a viable test path for this repository on the current macOS machine.

## Practical Testing Strategy For This Repo

On macOS, keep the current stack:

1. `cargo test`
   - covers real file IO, export paths, metadata changes, workspace scanning, and large-file primitives
2. `npm run test:e2e`
   - covers UI flows in the browser with mocked Tauri commands
3. `npm run tauri build`
   - verifies the real desktop bundle still builds

This gives broad confidence without relying on unavailable macOS WebDriver plumbing.

## If Native Tauri WebDriver Is Needed Later

Use a Linux or Windows CI runner and then wire in:

- `cargo install tauri-driver --locked`
- a desktop WebDriver test runner such as Selenium or WebdriverIO
- a built app binary from `src-tauri/target/debug` or `src-tauri/target/release`

The official Tauri docs should be rechecked before implementation, since platform support may change.

## Recommendation

Do not spend more time trying to force native Tauri WebView automation on macOS right now. The next highest-value testing work is to keep extending:

- Rust real file-flow coverage
- Playwright UI coverage
- release build verification
