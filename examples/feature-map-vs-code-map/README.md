---
name: feature-map-vs-code-map
title: Feature map vs code map
summary: Compare how three kinds of context guide an agent fixing a cross-feature shuffle bug.
kind: example
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
order: 740
---

# Feature map vs code map

A coding agent fixes a shuffle bug after a playlist edit in three independent runs: no map, a folder-level code map, and a feature map. The feature map records the playlist-to-queue link and how to verify it, as in the lesson's **Exploration** figure 2. Each agent run calls a paid model API.

## Run

```bash
npx mex open feature-map-vs-code-map
npx mex run feature-map-vs-code-map
npx mex run feature-map-vs-code-map --mode "feature map" --runs 3
npx mex run feature-map-vs-code-map --provider openai --model <model-id>
```

The default compares all three modes once. `--mode` takes `"no map"`, `"code map"`, or `"feature map"`; `--runs` accepts 1–5 trials per mode. In the page, press **Run agents** to start; opening the page costs nothing.

## What happens

1. Each run copies the same 18-file JavaScript music app in memory. A playlist save publishes an event; a separate subscription rebuilds the queue. The playlist ID stays fixed, but the cached order for that ID does not reset when its tracks change.
2. The agent gets the same four tools in every mode: list files, read a file, replace a file, and run a scenario. Only the map files and the hint that names them differ. A code map lists discoverable folders. Feature documents record Role, How to get there, How to verify (including the scenario steps), and Keep in mind. The shared instructions do not hand out the verify recipe.
3. Code replays `edit → shuffle → play 5` on the patched app with a fixed shuffle order. It checks the stable playlist ID, saved tracks, queue tracks, and five played tracks before counting repeats. No model grades the patch; deduping, copying, or re-saving the playlist does not clear its queue cache.
4. Compare completed fixes: an agent must leave a working patch **and** give a final answer within 18 requests. A working patch without a final answer shows **Did not finish**; a completed answer with a broken patch shows **Fail**. The cards show one step count, the replay result, and folded details. Each run also replays every saved patch privately, but that first-fix measurement does not affect the verdict or reach the agent.

Three real comparisons with OpenRouter's default model used 161 requests and cost **$0.0123**. The feature-map agents finished with a working patch in 3 of 3 runs; the no-map and code-map agents finished in 0 of 3 each. All six agents without a feature map left working patches but ran out of requests before answering. Every feature-map agent verified the repair and recorded the queue-cache hazard in `map/queue.md`. Results vary from run to run; in an earlier six-trial OpenRouter sweep with the same map-only recipe and 18-request limit, the feature map finished 5 of 6, no map 0 of 6, and code map 1 of 6. At 12 requests, almost every agent ran out, so 12 is not the default.

| Map | Finished with a working fix | Ran the bug scenario | Left a queue note |
| --- | --- | --- | --- |
| No map | 0/3 | 2/3 | — |
| Code map | 0/3 | 0/3 | — |
| Feature map | 3/3 | 3/3 | 3/3 |

## Try this

- Delete How to verify from `map/queue.md` in `music.ts`: does the feature-map agent still check its patch before it stops?
- In `compare.ts`, change the 18-request limit. Watch how many agents finish their repair and answer before they run out.
- In `music.ts`, remove the playlist-to-queue Keep in mind line. Check whether the feature-map agent still opens `queue/` and passes.
