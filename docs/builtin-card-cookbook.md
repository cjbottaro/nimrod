# Built-in card cookbook

Copy/paste prompts for seeing Nimrod's bundled cards in a real session. These are
manual acceptance recipes, not guaranteed tool dispatch or a record of passed tests.
Agents choose tools; availability, harness/model versions, permissions, installed
skills and MCP configuration affect what you see. A prose answer or shell substitute
does **not** exercise the requested card.

Use a disposable project for the write/edit recipes. Prompts below run real agent
work when **you send them**; web/GitHub recipes also use those external services.
No special plugin installation is needed for bundled cards. Personal plugins and
explicit renderer overrides can replace them; check your [plugin settings](card-plugins.md#matching-and-overrides)
if a card looks different. Source changes require a new app build; **Reload card
plugins** only reloads personal/manifest plugins, not Nimrod's bundled source.

## What to inspect each time

- Check the emitted tool card and **Raw inputs**, not just the agent's claim that
  it used a tool. Use transcript logs if the native identity is ambiguous. If a
  tool is unavailable, record that the recipe was not exercised.
- Inspect the summary, expanded body and literal raw recovery. **Raw output** appears
  when the presentation transforms or omits original output; it need not appear
  when the main result already contains the original text.
- Leave a disclosure open and focus/select output while more events arrive. The same
  card should update without resetting disclosure or pulling focus elsewhere.
- Distinguish an outer transcript scroll from the inner tool-output viewport. Inspect
  older output during streaming; new output must not steal your reading position.
- Tool completion/error is harness-reported. Requested content/diffs are not proof
  of a successful write. A useful failure card should retain its exact raw details.

Record app revision, harness/CLI version, model, prompt, actual tool, screenshot and
what passed/failed. Name the OS: a fixture pass or macOS observation is not Linux
acceptance. [Transcript debug logs](transcript-logs.md) can capture actual inputs,
results and metadata for a reproducible fixture; do not paste unrelated log content
or credentials into reports.

## Pi: seven built-in tools

These require a **Pi session** with the named tools enabled. Use the tools directly,
not a shell substitute. Recipes that create files use `nimrod-card-demo.txt` only;
choose another filename if it already exists. Do not overwrite existing work.

| Tool / card | Prompt | Expected presentation |
| --- | --- | --- |
| `read` | `Use the read tool to read README.md with offset 2 and limit 8. Do not use bash.` | Path and requested lines 2–9; literal result. These are requested lines, not invented returned line numbers. |
| `bash` | `Use bash to run: printf '\033[32mcard demo\033[0m\n'; sleep 2; printf 'finished\n'` | Command preview; live/final console output; green text if ANSI is supplied, plus raw escape sequences recoverable in Raw output. |
| `write` | `Use write to create a NEW nimrod-card-demo.txt containing exactly two lines: alpha and beta. If it exists, stop. Do not use bash.` | Destination and literal **Requested content**, separate from execution/result output. |
| `edit` | `Use edit to replace beta with gamma in nimrod-card-demo.txt. Make no other changes and do not use bash.` | Requested substitution diff, added/removed counts, **Wrap** and **Copy**. Requires the previous write recipe. |
| `grep` | `Use grep to search README.md for Nimrod. Do not use bash.` | Pattern/path preview; literal matches. |
| `find` | `Use find with pattern **/*.md and path docs. Do not use bash.` | Glob/path preview and literal filenames. |
| `ls` | `Use ls to list docs. Do not use bash.` | Directory preview and literal listing. |

For a multiple-substitution edit, ask for `alpha → ALPHA` and `gamma → GAMMA` in
one edit invocation using that tool's supported input. If the harness makes two
calls, inspect two cards rather than expecting a multi-edit counter on one.

For a harmless failure: `Use read to read nimrod-card-demo-definitely-missing.txt.
Do not create it or retry using another tool.` Confirm it really is absent first.

## Copilot: local inspection and commands

Use a **Copilot session**. Native tool names/categories differ from Pi, so these
recipes request the observed Copilot tools explicitly. Late metadata can improve
an existing card without replacing it.

| Card | Prompt | Expected presentation |
| --- | --- | --- |
| Shell | `Use your bash tool to run: printf '\033[32mcard demo\033[0m\n'; sleep 2; printf 'finished\n'. No file changes.` | Command preview and console-style live/result output; raw recovery if formatting changes the text. |
| Read file | `Use view to read README.md with view_range [2, 9]. Do not use a shell.` | **Read file**, project-relative path and requested range, cleaner literal content. Outside-project paths stay absolute. |
| Find files | `Use your file-pattern search tool to find **/*schema* under src. Do not use a shell or read file contents.` | **Find files**, pattern and supplied scope; literal results. A different native argument shape may retain generic presentation. |
| Local content search | `Use rg with pattern TODO, paths src, output_mode content and glob *.ts. Do not use bash or web search.` | **Search**, full pattern, scope and file filter. No matches is still a valid result. |
| Skill | `Use the skill tool to load the installed skill named <installed-skill-name>. Do not install anything or perform its workflow; just load it.` | **Use skill** plus its real name and native outcome. Replace the placeholder with a skill available to that Copilot session. Missing skills can show errors; the card does not install them. |

## Copilot patches

In a disposable project/worktree, ask:

```text
Use apply_patch to add card-patch-demo.txt containing "before", then use a second
apply_patch call to change it to "after". Do not use shell redirection or another
editing tool. Leave the file for inspection.
```

Expect **Apply patch** with the first affected path (project-relative when inside
this project), plus a path count for multi-file/move requests. Expanding a complete
request shows a colored **Requested patch**. A recognized successful native result
replaces it with **Applied patch**, showing Copilot's reported Git diff and a short
file-change result. Failed/interrupted calls never label the request as applied.
**Raw inputs** and **Raw output** retain the exact original patch and result details.
The card does not independently verify disk contents or provide an Apply button.

## Copilot SQL

This is Copilot's built-in `sql` tool—not a shell command or an MCP database tool.
It can be used for its task bookkeeping, but Nimrod does not infer a database scope
or build a persistent checklist by parsing SQL.

A read-only recipe, with no project file changes:

```text
Use your built-in sql tool, not bash or an MCP server. Set description to
"Inspect SQL card demo" and execute:
SELECT 1 AS card_demo, 'ready' AS status;
If that tool is unavailable, say so; do not substitute another tool.
```

Expect **SQL** with **Inspect SQL card demo** in the summary. On a recognized
successful completion, **Results** includes the supplied statement/affected/returned
row counts and shows the concise result text. Metrics are optional: their absence
must not prevent a useful result. Tables remain literal text, not an interactive grid.
**Raw inputs** retains the query; **Raw output** retains the detailed SQL/result and
metadata whenever the displayed result differs.

To exercise task progress like the original screenshot:

```text
Use your built-in sql tool to track two demo todos with IDs
nimrod-card-demo-read and nimrod-card-demo-search. Do not change existing todos.
Give each SQL call a short description. Read README.md and search docs for
"session" using your native inspection tools; update only these demo todos as
work proceeds, then SELECT their IDs and statuses. Do not modify project files
or use bash/MCP as a SQL substitute. If sql/todos is unavailable, report that.
```

Expect separate SQL cards for creation/progress/query if Copilot chooses those
calls, with its actual descriptions/counts/results. Do not expect Nimrod task
checkboxes or human task titles reconstructed from prior SQL calls. If the agent
batches operations, the reported statement count can exceed one.

## Copilot question/answer

```text
Use ask_user to ask "Which card-demo label should I use?" with choices "Alpha"
and "Beta". Wait for my answer; do not choose on my behalf.
```

While pending, use the **Question picker** (or **Answer question** banner). Choose
**Beta**. After the tool reports the answer, expect a speech-bubble icon, the question
and an inset literal reply. Expand for numbered choices and raw details. Repeat
and use **Enter your own answer…** with a multiline answer containing `**literal**`
to inspect wrapping and literal text. Dismissing the picker is not an answer and
must not fabricate a completed question/answer card.

## Copilot web and GitHub MCP

These recipes need the corresponding tools/authentication in your Copilot session
and use external services when sent. If unavailable, report the missing prerequisite;
do not silently substitute shell/curl, another MCP server or a prose-only answer.

### Web search

```text
Use github-mcp-server's web_search tool to search for "TypeScript official
handbook narrowing". Return a short sourced answer. Do not use bash or curl.
```

Expect a query summary, formatted **Answer**, numbered citation links and **Sources**
with titles/domains **when the native result supplies structured citations**.
Unstructured or unknown result shapes stay generic/literal. Other MCP query tools
must not accidentally become web-search cards.

### Fetch

```text
Use web_fetch to fetch https://www.typescriptlang.org/docs/handbook/2/narrowing.html.
Do not use bash/curl or edit files. If a URL permission is requested, wait for me.
```

Expect **Fetch** plus the URL, a linked **Page**, and readable content for a recognized
response. A reported redirect becomes **Redirected to**; an explicit truncation note
becomes **Partial content**. Neither is guaranteed by this URL. Raw/MIME responses
remain literal. Links open only when clicked. Declining a requested permission can
exercise the error path; do not change your saved permission policy just for this.
Do not assume successful content was received if the service/permissions failed.

### GitHub code search

```text
Use github-mcp-server's search_code with query "repo:microsoft/TypeScript
isString language:TypeScript". Do not clone, fetch through bash or modify files.
```

Expect **GitHub code search**, exact query, returned/total counts when supplied,
paths and literal snippets. Server-reported incomplete results or a clipped agent
preview should remain qualified; Nimrod does not fetch hidden output files.
External rate-limit/header/auth errors remain errors, not successful search cards.

### GitHub contents

```text
Use github-mcp-server's get_file_contents to read README.md from
microsoft/TypeScript. Do not clone, use bash or modify files.
```

Expect **GitHub contents** and `microsoft/TypeScript/README.md`, with the native
outcome. Unknown successful file-content schemas remain literal rather than being
guessed/decoded. Other MCP tools show actual server/tool identity and generic results.

## Generic, reasoning and parallel presentations

- **Generic tool / raw fallback:** use an already-enabled custom tool without a
  matching personal/bundled specialization: `Call <actual-tool-name> with <valid
  arguments> once; do not substitute another tool.` Expect its native name/title and
  literal output. There is no universally installed demo custom tool. In Pi, an
  explicit `nimrod.raw` override can show preview-free raw output; restore your own
  setting afterward. See [matching and overrides](card-plugins.md#matching-and-overrides).
- **Reasoning:** with a model/configuration that actually exposes reasoning, ask:
  `Compare two approaches to indexing a small in-memory session list. Explain the
  tradeoffs; do not run tools or modify files.` Inspect supplied reasoning separately
  from the final answer. A prompt cannot force hidden reasoning to be disclosed.
- **Parallel-tools overview:** in Pi, ask: `Run two independent bash calls concurrently:
  sleep 5; printf 'one\n' and sleep 5; printf 'two\n'. Do not combine them into one
  command or run sequentially.` The temporary overview requires genuinely overlapping
  calls; individual tool cards remain. A model executing them sequentially did not
  exercise the overview.
- **Generic ACP fallback:** retained internally, with no current product creation UI.
  Do not use old ACP instructions to create a Copilot session. There is no supported
  in-app prompt recipe for this internal adapter.

[Operation cards](reading-conversations.md#operation-cards), permission pickers,
configuration changes and slash-command output have their own interaction contracts;
they are not extra tool-plugin families. The optional [Pi Web Access cards](pi-web-access-plugin.md)
are an external plugin, not bundled. Automated fixtures complement these manual
recipes; they do not establish native/platform acceptance.
