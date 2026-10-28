---
name: image-sidecar-notes
title: Image sidecar notes
summary: A grep agent cannot find facts that exist only in images, and a text note written once per image at intake fixes this.
kind: example
order: 265
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Image sidecar notes

Grep works well on text and code, but it cannot find a fact that exists only in an image. This example shows that, and compares two fixes: a text note written once per image (a sidecar note), and a `view_image` tool.

An agent answers six questions about a small team knowledge base. Only an image holds the answer to three of them. The agent runs in three modes: grep on the knowledge base as it is, grep after intake wrote a sidecar note next to each image (`<image>.md`), and grep plus a `view_image` tool. Code checks each answer for the facts in it. The run also compares the cost of intake, paid once, with the cost of the image on every question.

The example calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. One run sends 3 vision requests for intake, then does 18 agent runs of 2 to 6 requests each. With the default model, this costs less than 1 cent. We checked image input on OpenAI only. We did not check vision on OpenRouter.

## Run

```bash
npx mex open image-sidecar-notes
npx mex run image-sidecar-notes
npx mex run image-sidecar-notes --mode view --question ports
npx mex run image-sidecar-notes --answers
npx mex run image-sidecar-notes --provider openai
```

`--mode` is `grep`, `sidecar` or `view` (default: all three). `--question` is one of `ports`, `threshold`, `retry`, `retention`, `freeze`, `migration` (default: all six). `--answers` prints each answer in full.

The page runs all modes on all questions. Press **Run all modes**.

## What happens

1. `base/` holds 12 short Markdown notes of a made-up payments team. `images.ts` draws three PNG images in code, with the encoder from `image-detail-probe/png.ts`:
   - a service map with ports,
   - a latency dashboard with an alert line and the latest value,
   - a whiteboard photo with a decision, an owner and a due date.

   The notes name each image file, for example "the port of each one is on the service map: architecture/services.png". No note holds a port, the threshold or the decision.
2. `questions.ts` holds six questions and their answer key. Only an image answers three of them (7 facts). A text note answers the other three (6 facts), as a control. A check looks for the exact value, for example `7070`, `850`, `Marek` or `14 Nov`. A general answer does not pass.
3. `base.ts` gives the agent three tools on an in-memory copy of the knowledge base:
   - `search`: a case-insensitive regular expression over the text files. It skips images, as ripgrep skips binary files.
   - `read`: one text file. For an image, it returns an error: "a PNG image, not text".
   - `list`: every file with its type.
4. Intake (`intake.ts`) runs in the sidecar mode only. It sends one vision request per image, with the image in the user message. The model writes a short Markdown note with every label, number, name and date in the image. The code adds the line `Image: <path>` and keeps the note in memory as `<image>.md`, next to the image. Intake runs one time. The run shows its cost separately.
5. `runAgent()` in `agent.ts` is a plain tool loop with reasoning effort `low`. The mode changes only which files the tools can reach:
   - **Grep only**: the knowledge base as it is. The agent finds the image by its name, cannot open it, and says so.
   - **Sidecar notes**: the same tools, on the knowledge base with the three sidecar notes. A search for "port" or "ledger" now finds lines in a sidecar note.
   - **View tool**: no sidecar notes, and a fourth tool, `view_image`. Its result is the image itself. The tool result (`function_call_output`) carries `output` as a list with one `input_image` part, not as a string. We checked this with a real OpenAI request: the next request read the ports from the image. A JSON tool result plus a user message with the image also worked. We keep the image in the tool result, so the conversation has no user message that the user did not write. The image then stays in `input` for every later request of that run.
6. Before the agents start, the CLI greps for each image fact. Before intake, no file has it. After intake, the sidecar note has it. Then the CLI prints, per mode and question: the facts found, the files the agent used (read, found by search, viewed), the requests and the cost. Last, it prints the cost: intake one time, and the average cost per image question with sidecar notes and with `view_image`. It also prints after how many image questions intake costs less. When a view run costs less than 10% more than a sidecar run, it says that the two cost about the same. One run per question varies more than that.

The page shows the same results. At the top, it shows the image facts found per mode, with one table row per question. Below, it shows the cost, the sidecar notes, and each answer.

What we saw with the default model on OpenAI, 3 runs:

| | Grep only | Sidecar notes | View tool |
|---|---|---|---|
| Image facts | 0 of 21 | 20 of 21 | 20 of 21 |
| Text facts | 18 of 18 | 18 of 18 | 18 of 18 |
| Requests for 6 questions | 20 to 21 | 15 to 16 | 17 to 18 |
| Cost of 6 questions | $0.0014 to $0.0016 est. | $0.00079 to $0.00098 est. | $0.0010 to $0.0011 est. |

Intake cost $0.00031 to $0.00035 (est.) for the three images, in about 3 seconds. Per image question, a sidecar run cost $0.00018 to $0.00024, and a view run cost $0.00024 to $0.00025. In two runs, intake cost less after 6 image questions. In the other run, the sidecar runs took more steps by chance, and the two modes cost about the same per question.

Grep only never found an image fact. It was also the most expensive mode: the agent continued to search for a value that no text holds, with up to 6 requests per question. The two other modes found almost every image fact. The costs are small because these images are small: about 250 input tokens each at `detail: 'high'`. A full-size screenshot costs more tokens, and every request after a `view_image` call pays for it again.

The two misses show the risk of a sidecar note. Two times, the model read the ledger's port `7070` as `7270`: one time while it wrote a sidecar note, one time in a `view_image` run. The view-mode error changed one answer. The sidecar error went into a note, so every later answer that searched for the port got the wrong value. In one intake, the model also read the small label "DRAWN" as "BRAIN". Intake writes a sidecar note one time, so check it one time.

The lesson also names multimodal embeddings for image search. This example cannot show them: the default embedding model in `shared/providers.ts` accepts text only.

## Try this

- In `intake.ts`, change `DETAIL` to `'low'`. Intake and `view_image` both cost less. Look at the sidecar notes: are `7070` and `612` still correct?
- In `base/architecture/overview.md`, `ledger.md` and `base/index.md`, delete the lines that name `architecture/services.png`. Run `--question ports`. Does the view mode still find the image, now only with `list`? The sidecar mode does not need the name: a search for "ledger" finds the sidecar note.
- In `intake.ts`, change `SIDECAR_INSTRUCTIONS` to "Describe the image in one sentence." Run `--mode sidecar`. A short description drops the numbers, so grep cannot find them.
