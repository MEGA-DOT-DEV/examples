---
name: image-detail-probe
title: Image detail probe
summary: Code draws seven kinds of simple pictures that vision models often read wrong, and checks how many answers a model gets right at low and at high image detail.
kind: example
order: 75
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Image detail probe

A person sees at once if two circles touch or how many times two lines cross. A vision model often does not. This example draws seven kinds of simple pictures in code, after the paper [Vision Language Models Are Blind](https://vlmsareblind.github.io), so code knows the right answer to each one. The model reads each picture twice: as an `input_image` with `detail: "low"` and with `detail: "high"`. Code checks every value.

It calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. The default run sends 42 requests (7 tasks × 3 pictures × 2 details). With the default model on OpenAI, that costs about half a cent.

## Run

```bash
npx mex open image-detail-probe
npx mex run image-detail-probe
npx mex run image-detail-probe --seed 7 --pictures 4
npx mex run image-detail-probe --task circles --task squares
npx mex run image-detail-probe --mode high
npx mex run image-detail-probe --provider openai
```

`--seed` (1 to 99999) selects the pictures: the same seed always draws the same pictures. `--pictures` is the number of pictures per task, 1 to 4 (default 3). `--task` runs one task, and you can give it more than once: `lines`, `circles`, `letter`, `rings`, `squares`, `grid` or `subway`. `--mode` is `low` or `high` (default: both). On the page, the pictures per task and the seed are under More settings.

## What happens

1. `tasks.ts` draws each picture from the seed, 768 × 768 pixels, and computes its key from the numbers of the shapes (`geometry.ts`), not from the pixels:
   - **Line intersections**: a blue line and an orange line, 2 or 3 segments each, 1 to 3 pixels wide. How many times do they cross: 0, 1 or 2? Half of the pictures have no crossing, and most have a near miss, where the lines come within a few pixels.
   - **Two circles**: two filled circles with a gap of 1 to 3 pixels, a touch, an overlap of 1 to 3 pixels, or a clear gap or overlap. Do they touch or overlap?
   - **Circled letter**: a word or random letters, with a red oval around one letter. The oval also covers parts of the letters next to it. Which letter is in the oval?
   - **Overlapping shapes**: 5 to 9 circles or pentagons, drawn as outlines in two rows like the Olympic rings. How many shapes are there, and how many pairs overlap?
   - **Nested squares**: 2 to 5 squares inside each other, often only 2 to 6 pixels apart. How many squares?
   - **Counting grid**: a table of 3 to 9 rows and 3 to 9 columns, empty or with words in about half of the cells. How many rows and columns?
   - **Subway map**: 2 to 4 coloured paths with right angles between the stations A, B, C and D. How many paths go from A to C, which colours connect B and D, and how many times do two paths cross?
2. Each picture shows its key exactly in its pixels. Circles that touch meet along a row or a column of pixels: no shared pixel, but two pixels side by side. A gap of 1 pixel is 1 empty pixel. Lines that do not cross keep 3 empty pixels or more, and lines that cross meet at 15° or more, away from a bend or an end. The tests in `tasks.test.ts` read each key back from the pixels. `png.ts` draws the PNG: a small encoder on `node:zlib`, with no package.
3. `probe.ts` sends one request per picture and detail. The user message is the question, then the image. Only `detail` changes. The answer is structured output with one schema per task (`strict: true`).
4. Code checks each answer against the schema with `check()`, then compares each value with the key. Every value must equal the key: a number, a letter in any case, or the same set of colours in any order.
5. The result says how many values each detail got right and names the tasks with a wrong value. A table shows the right values per task, with the input tokens, the cost and the time per request. Each task shows its pictures with the key and the answer at each detail. A wrong value is red. On the page, click a picture to see it at full size.

## What we saw

With the default model on OpenAI (`gpt-6-luna`, reasoning effort `low`), one run of seeds 1 to 10 with 3 pictures per task: 420 requests, about 5.6 cents (OpenAI price, estimated).

| Task | Low detail | High detail | The wrong answers |
|---|---|---|---|
| Line intersections | 29 of 30 | 27 of 30 | All four: a near miss counted as a crossing. |
| Two circles | 24 of 30 | 26 of 30 | A gap of 1 or 2 pixels called "touch or overlap" (9 of 10). One touch called "no" at low detail. |
| Circled letter | 28 of 30 | 29 of 30 | A letter of a similar shape in the pixel font: C read as O twice, M read as H. |
| Overlapping shapes | 57 of 60 | 59 of 60 | One overlapping pair too many, every time. The number of shapes was always right. |
| Nested squares | 26 of 30 | 29 of 30 | One square too many, every time. The squares were 2 or 3 pixels apart. |
| Counting grid | 60 of 60 | 60 of 60 | None. |
| Subway map | 80 of 90 | 83 of 90 | Mostly crossings: 1 to 3 too few in 13 of the 17 wrong values. |

- **Every task but the grid** got some values wrong at both details. The model did not fail the same pictures at low and at high detail: of the 10 wrong circle answers, only 2 pictures went wrong at both.
- **The grid** was always right, also in a test with 10 to 16 rows and columns (47 of 48 values). We kept the range of the paper, 3 to 9.
- **Low detail lost more** on the circles (6 wrong against 4), the squares (4 against 1) and the subway map (10 against 7). High detail lost more on the lines (3 against 1).
- **Tokens**: we measured one picture per task. At high detail, each used 384 more input tokens than at low detail, for example 757 against 373 for the circles. The difference was the same for every task, whatever the picture shows. The tasks differ only by the length of their question.

The default run (`npx mex run image-detail-probe`, seed 1) got 27 of 33 values right at low detail and 30 of 33 at high detail. Results change from run to run, so run it twice before you trust one wrong answer. We did not check OpenRouter: there was no OpenRouter key when we made this example. So we do not know if OpenRouter sends `detail` to the model.

## Try this

- Run `--task circles --pictures 4 --seed 3` and read the notes beside the answers: which gaps does the model call a touch? Then, in `CIRCLE_GAPS` in `tasks.ts`, make the small gaps 6 to 8 pixels (`rnd.int(6, 8)`) and run it again. Does the model still answer "yes"?
- Run `--task subway --mode high`. The model often counts fewer crossings than the key. In `subway()` in `tasks.ts`, make every path 10 pixels wide (`const width = 10`) and run it again. Do wider paths help, or do they hide more?
- In `MODES` in `probe.ts`, set the `detail` of the low mode to `'auto'`, and run `--mode low --task grid`. Which detail does the provider choose for a 768 × 768 picture? The input tokens tell you: about 372 for low, about 756 for high.
