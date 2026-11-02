---
name: false-success-tool
title: Did the track play?
summary: A music service returns 200 even when nothing plays; a tool that checks the player stops the agent's false claims.
kind: example
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
entry: index.ts
---

# Did the track play?

Some APIs return status 200 even when the action did not happen. A tool that only passes on that status makes the agent claim success. A tool that reads the real state after the action catches the failure. This example calls a paid model API and checks each claim against a fake player.

## Run

```bash
npx mex open false-success-tool
npx mex run false-success-tool
npx mex run false-success-tool check --provider openai
```

## What happens

1. Eight requests ask the agent to play eight tracks. In three of them, the living room speaker holds playback, so the play command changes nothing. The fake music service still returns status 200.
2. Both modes give the agent the same two tools, `play_track` and `transfer_playback`, and the same instructions. Only the code in `play_track` differs. In **Trust the status**, it returns the service response: `{"status": 200}`. In **Check the player**, it also reads the player state. When the track did not start, it returns `ok: false`, the reason and a hint to move playback to the built-in player.
3. The agent ends each request with a structured answer for the app: `playing` (true or false) and a message for the user. Code compares `playing` with the real player state. A mismatch is a false claim.

In 8 runs of each mode with the default OpenAI model, **Trust the status** had 3 false claims in every run: all 24 requests with the held speaker said "playing" while the player was stopped. **Check the player** had 0 false claims in 64 requests. In each held-speaker request, the agent moved playback to the built-in player and the track played.

## Try this

- Run **Trust the status**, then **Check the player**. Compare the three rows marked "Speaker holds playback".
- In `player.ts`, remove the `hint` from the checked `play_track` result. See if the agent still finds `transfer_playback`, or tells the user that the track did not start.
- Add a `get_player_state` tool to `TOOLS` and handle it in `runCase()`. In **Trust the status**, count how often the agent checks the state on its own after a 200.
