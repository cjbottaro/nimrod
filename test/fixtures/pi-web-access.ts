// Synthetic offline text fixtures modeled on pi-web-access 0.38.0 web-tool-core.ts.
// No extension import, network/provider call, auth/config access, or actual stored response.
export const searchText = `**Provider:** exa

## Query: "TypeScript DOM plugins"

1. DOM lifecycle guide
   https://docs.example.test/dom

2. Rendering controls
   https://example.test/controls

## Query: "TypeScript cache"

1. Disk cache guide
   https://docs.example.test/cache

---
Full search results are stored as responseId "search_fixture". Use get_search_content({ responseId: "search_fixture", queryIndex: 0, offset: 0, limit: 4000 }) to retrieve the first bounded page; repeat with queryIndex 1 through 1.
`;
export const fetchedText = `# Example guide

A **readable** document with [local guidance](./next) and [source](https://docs.example.test/reference).

\`\`\`ts
const value = '<script>not executable</script>';
\`\`\`

---
Showing 100 of 1000 chars, 100 of 1000 bytes, and 10 of 50 lines. Use get_search_content({ responseId: "fetch_fixture", urlIndex: 0, offset: 100 }) for the next slice.
`;
export const storedText = `## Results for: "DOM widgets"

**Provider:** brave

### DOM lifecycle guide
https://docs.example.test/dom

An original snippet retained in the result text.

### Rendering controls
https://example.test/controls

Another snippet.
`;
export const checkText = `# Source check: Example claim

**Status:** needs_review (confidence 0.50)
**Rationale:** Evidence gathered for manual review.
**Supporting passages:** passage-1

## Sources
1. [primary] Original specification
   https://docs.example.test/specification

Artifact responseId: research_fixture (retrievable via get_search_content).
`;
