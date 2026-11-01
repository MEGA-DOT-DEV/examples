---
name: memory-extraction
title: Memory extraction
summary: Three memory modes read the same six conversations, and a score shows which mode keeps outdated facts, mixes up two people, or saves duplicates.
kind: example
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
order: 530
---

# Memory extraction

An agent saves facts from a conversation, so it can use them later. This example replays six short conversations with three memory modes and scores the memory that each mode keeps. The conversations test a changed fact, two people named Alex, known facts in new words, a message about an unknown Alex, and a short stay. This example calls a paid model API: one run sends 18 requests, plus one for each session in which the agent calls a memory tool. That is about 24 requests, under 1 cent.

## Run

```bash
npx mex run memory-extraction
npx mex run memory-extraction --provider openai --model YOUR_MODEL_ID
npx mex open memory-extraction
```

## What happens

1. Each mode starts from empty memory and reads the same six dated messages in order. Each message sends one request to the model.
2. **One profile** uses a background extraction request. It adds each fact to one document for all people named Alex. It never replaces a fact.
3. **Memory tools** gives the agent `memory_save` and `memory_update` during the session. The agent decides when to call them. When the agent calls a tool, one more request sends the tool results back.
4. **One document per person** uses a background extraction request. It keeps one document per person and replaces a fact when its value changes. When a message does not say which Alex it is about, it holds the fact in a note.
5. The code compares the final memory with five expected facts. It counts facts kept, outdated values, mixed people, duplicates and held notes. In one profile, mixed people means one fact type with values from both Alexes. In the other modes, it means a fact filed under the wrong Alex.
6. The CLI prints each session's changes, the requests and responses, the final memory and the score. The page shows the score first, then each mode's final memory. The changes in each session and the requests are folded. Cost from OpenAI is an estimate.

Results depend on the model's decisions. The messages and the expected facts stay the same.

## Try this

- Change the message about the move in `memory.ts` and the matching expected fact. Then see how often the old city stays in memory.
- Change the cycling message so it names Alex Rivera, and set its `identity`. Then see if one document per person saves the fact instead of a held note.
- Change the wording of the last message. Then see if a mode saves the short-answer preference a second time.
