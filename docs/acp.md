# ACP infrastructure

ACP is retained internally for possible future harness integrations. It is not a
current user-facing session option. Nimrod exposes Pi and [Copilot](copilot.md).

**New ACP session…** and **ACP session options…** have been removed from the
command palette, shortcut dispatcher and keybinding editor. Existing overrides
for those action IDs remain stored but inert. Saved Copilot ACP entries are not
restored or migrated; old stored drafts and agent-owned history are not deleted.

Reusable protocol, native ownership, session/presentation adapters, generic tool
cards and offline fixtures remain in the source. Keeping that infrastructure does
not enable a custom-agent creation UI, saved history, Resume or deletion.
