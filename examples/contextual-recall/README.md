---
name: contextual-recall
title: Contextual recall
summary: Find a memory from the whole conversation and the user profile, not only from the last message.
kind: example
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
order: 580
---

# Contextual recall

A last message such as “What should I do tomorrow?” gives a memory search little to work with. This example runs three searches on 20 synthetic memories and compares what each one loads: the last message alone, a conversation query, and a conversation query with a rerank. It calls paid embedding and model APIs.

## Run

```bash
npx mex open contextual-recall
npx mex run contextual-recall
npx mex run contextual-recall pickup --provider openai
```

The first argument picks a conversation: `run` (the default), `pickup`, `release`, `dog`, `travel`, `dinner`, `invoice` or `commute`. The page lists the same eight conversations by title. Add `--model <id>` to change the answer model. To change the embedding model, set `MEGA_OPENAI_EMBEDDING_MODEL` or `MEGA_OPENROUTER_EMBEDDING_MODEL`.

## What happens

1. Embed the 20 memories. The user profile is not one of them. The viewer embeds them once per provider and embedding model, and reuses the vectors on the next run.
2. Ask the model for a conversation query: one search text written from the whole conversation and the user profile.
3. Embed the last message and the conversation query in one request.
4. **Last message** and **Conversation query** each load the two memories with the highest similarity to their search text.
5. **Conversation query + rerank** sends the top five memories of the conversation query to the model. The model picks two of them.
6. For each search, the same model answers with only its two loaded memories.
7. Code scores each search with the answer key. It counts the key memories that the search loaded. It counts the key facts that the answer uses in the exact words of the key. A correct paraphrase counts as missing. The model never sees the answer key.

The model can write a poor conversation query. The rerank cannot recover a memory that is not in its five candidates.

## Try this

- Pick “Pick up Sam”. The profile names two people called Sam. Check whether the conversation query finds the memory about the father, not the teammate.
- Pick “Ship the app”. Compare the two memories of **Conversation query** with the two of **Conversation query + rerank**. The rerank reads the memory text, not only the similarity.
- Pick “Dinner with Eli”. Compare the key facts with each answer. A search can load the key memory while the answer still misses a key fact.
