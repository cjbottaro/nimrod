# Historical tool-only logging verification

**Historical evidence, not current instructions or acceptance of transcript logging.** Current contracts: [Transcript logging](../transcript-logs.md). Current evidence/gaps: [Verification](../verification.md#transcript-logging).

Before expanded transcript logging, the tool-only SDK logging follow-up ran `mise run test`: TypeScript and 88-document link/anchor validation passed; Node results were **918 passed / 4 failed**. The four blockers were unrelated migration assertions: public-import allowlist, ACP/SDK target-error text, legacy ACP loading label and Resume Open ARIA label. Logging-specific controller/sink/permission/replay tests and the Settings-to-IPC shell fixture passed. The command stopped before Rust formatting, Clippy and full Rust tests.

A focused run passed **13 Node tests**, including the production bridge with an offline fake SDK, and the then-named `cargo test ... tool_capture::tests` passed **6 native storage fixtures**, including distinct `copilot-sdk/copilot/` output. Those names describe the historical command/module, not a supported current alias.

No browser run, packaged build, app launch, installed SDK request, live session load/deletion or paid provider work was performed for that verification. These results do not validate expanded full-content logging, later rotation/chunking, the naming cleanup or current platform acceptance.
