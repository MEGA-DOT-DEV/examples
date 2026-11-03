---
name: tool-skill-links
title: Tool and skill links
summary: An image tool and its style skills name each other, so the agent loads the skill before the call, and still uses either one alone.
kind: example
order: 600
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Tool and skill links

A skill can shape a tool call only when the agent knows that the two belong together. Here one server has an image tool and three style skills. When the tool description names the skills and each skill names the tool and its arguments, the agent loads the skill first. The link does not force them together: a plain image still uses the tool alone. It calls a paid API.

## Run

```bash
npx mex open tool-skill-links
npx mex run tool-skill-links
npx mex run tool-skill-links --mode linked --provider openai
```

`--mode` is `unlinked`, `linked` or `all` (the default). `--provider` and `--model` are optional.

## What happens

1. The server has three tools: `list_skills`, `load_skill` and `generate_image`. The image tool is a stub: it records the arguments and draws nothing.
2. Three style skills set exact arguments: pixel art (96 × 96, 12 colors, no smoothing), blueprint (1600 × 1000, 2 colors) and watercolor (1200 × 1500). These numbers are not defaults, so the model cannot guess them.
3. The agent sees a skill only when it looks: it must call `list_skills` or `load_skill`. The instructions say only "You make images for the team with your tools."
4. Five requests run in two modes, with the agent loop from `agent-loop` at effort `low`. Three need a style. One photo needs no skill. One question needs the pixel-art skill and no image.
   - **No links**: the tool description says only "Generate an image". The skills describe the style in words.
   - **Linked**: the tool description names the three style skills and says that a plain image needs no skill. Each skill says "Use it with generate_image" and gives the exact arguments.
5. Code scores each request. A styled image passes when its skill loaded and all four arguments match. The photo passes with no skill. The question passes with the skill and no image.

In October 2026, with OpenAI's default model, the agent without links never looked for a skill before it made an image: 0 of 3 styled images passed in 8 of 8 runs. With links, 3 of 3 passed in 4 of 4 runs. The photo and the question passed in both modes every time. One run of both modes is about 20 requests and cost about $0.0011 (est.).

We also tried a version with the skill list in the instructions. There, at effort `low`, the default model loaded the right skill in both modes in 2 of 2 runs, one of them with 9 other skills in the list. The link matters most when the agent has to look for skills itself.

## Try this

- Change the watercolor request to "Paint a watercolor of the office at sunset for the newsletter." In our runs, the linked agent then skipped the skill in 6 of 6 runs: the word "paint" was enough for the model to treat the style as part of the prompt.
- Delete "A plain image needs no skill." from the linked tool description in `links.ts`. See if the photo request starts to load a skill.
- Ask for the skill by name in a request, for example "Use the blueprint skill for a drawing of a chair." Compare the two modes: the unlinked skill gives the style in words, and the agent has to map the words to arguments.
