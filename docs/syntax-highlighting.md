# Syntax highlighting

Code blocks use the language named after their opening Markdown fence, such as
`elixir`, `typescript` or `json`. An explicit label always wins, whether the block
comes from you or the agent. Unsupported labels and explicit `text` or `plaintext`
fences stay plain text.

When you paste code in triple backticks without a language (or use indented code),
Nimrod tries to detect it. Only a strong, unambiguous guess is accepted. Accepted guesses show **(detected)** beside
the language; weak or ambiguous snippets stay plain text. This is a heuristic,
not a guarantee—short Elixir snippets, for example, can tie with Ruby. Label the
fence `elixir` to remove that ambiguity.

Unlabeled agent and reasoning code stays plain text; detection is only enabled for
user text, including pending steering turns.

Elixir is supported with `elixir`, `ex` and `exs` labels; Erlang with `erlang` and
`erl`. The usual common programming languages and their aliases (such as `js`,
`ts`, `py`, `sh` and `yml`) remain supported. Language names are case-insensitive.

For example:

````markdown
```elixir
defmodule Example do
  def hello(name), do: {:ok, "Hello #{name}"}
end
```
````

[Pop-outs](pop-outs.md) keep the explicit or detected language captured from the
transcript; they do not guess again. Copy returns the source, not highlighting
markup. Existing pop-outs keep their captured language label; highlighting does
not reinterpret or rewrite saved snapshots.

Not every Highlight.js language is bundled, and there is no manual language picker
yet. If an agent supplies the wrong explicit label, Nimrod follows that label—ask
it to use the correct fence language. Colors follow your selected [theme](themes.md).
