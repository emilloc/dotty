---
name: siftrank
description: Rank collections of passages, code, files, search results, or research leads by semantic relevance using the explicitly configured Spark model. Use when the collection is too large to inspect directly. Exact-match lookups do not need ranking.
---

# SiftRank through Pi

Use the sibling `rank.py` with Pi's ordinary `bash` tool. Do not use a Codex adapter,
delegate tool, raw unconfigured SiftRank command, or host-side networking fallback.
The installed profile is `~/.config/siftrank/pi-local.json`. It pins an endpoint
and model independently of Pi's conversational model. Missing configuration,
an unavailable forward, or a different loaded model is an error, not a reason
to choose another provider. Setup instructions are in `README.md` beside this skill.

1. Define the ranking criterion from the user's objective. Enumerate the candidate
   collection with existing tools, without reading the whole corpus into chat.
2. Write a JSON array of objects with unique string `id`, string `source` locator,
   and string `text`. Additional metadata is retained but not presented to the model.
   Keep source and surrounding context needed for the judgment. Split text over
   6,000 characters at meaningful boundaries, with parent IDs and precise locations.
   Never silently truncate or discard candidates. Keep the original source corpus.
3. Write the criterion to a text file. Run the following with absolute file paths,
   resolving `rank.py` relative to this skill file. Use a new artifact directory
   in the project, or Pi's session scratch directory in Plan mode.

   ```sh
   python3 /absolute/path/to/pi-siftrank/rank.py \
     --input /absolute/path/candidates.json \
     --criterion /absolute/path/criterion.txt \
     --output /absolute/path/new-ranking-run
   ```

   The default is concurrency 1, two trials, batches of at most 16, no refinement,
   and a 180-second process deadline. Set the bash timeout above that deadline
   (for example 200 seconds). Use `--trials 1` for a bounded pilot, then repeat.
   The launcher accepts 2 to 256 candidates, `--trials 1..5`, and `--timeout 10..600`.
   Do not repeatedly retry timeouts. Diagnose load, item size, or backend failure.
4. Inspect `summary.json` and the validated `ranked.json`. Read top candidates in
   their original context. Ranking is prioritization, not proof. A low rank does
   not establish irrelevance, absence, or grounds to close a research question.

For a ranking-only request, report `summary.json`'s `top` list and stop. Those
`id` values are the original candidate IDs. In full `ranked.json` rows, use
`row.document.id` and `row.document.source`. `row.key` is SiftRank's internal key,
not the original ID. Lower scores are better. Do not guess field names or
reinspect the CLI implementation to interpret this documented output.
`siftrank_version` identifies the CLI, not the model. Validation compares parsed
record values, not byte-for-byte JSON formatting.

The launcher prints only a bounded top list. Full input, criterion, presentation
template, secret-free profile, command, model discovery, logs, trace, and output
stay in the artifact directory. Preserve that directory when citing a ranking.
`ranked.raw.json` alone is not accepted output. Errors, missing candidates,
changed records, or unexposed candidates fail the run.

Use `python3` from PATH, not an absolute interpreter path. Setup adds only the
skill directory to `sandbox.insideRoots`. This keeps execution inside the
sandbox when the skill lives outside the project. An "outside project" bash
approval in this extension runs unsandboxed. Do not approve that prompt for ranking.
The launcher also refuses to run without a local filtered HTTP proxy.

Build, Default, and Plan use the existing filtered proxy with a narrow
`localhost:18888` grant (or the configured port). Default/Plan can still ask for
ordinary command approval. Blind and offline research modes have no ranking access.
Never change modes or approve a sandbox escape just to make ranking work.
On another device, install separately and provide an existing forward to the same
service. No model server is installed by this integration.

Ranking shares inference capacity with Pi. Keep concurrency 1. The stock CLI has
a 15-second request timeout and internal retries. Its trial count is not a hard
HTTP-attempt cap. The outer deadline bounds the process, not server work already
accepted. Do not schedule concurrent ranking runs against the shared service.
