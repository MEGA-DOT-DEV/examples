---
name: structure-test-loop
title: Structure test loop
summary: A designer agent files 24 raw items into folders, a separate tester checks the structure against a clear definition of good enough, and a loop sends the misses back.
kind: example
order: 270
needs: []
needsAny: [OPENROUTER_API_KEY, OPENAI_API_KEY]
---

# Structure test loop

An agent can design the structure of a knowledge base, but it cannot tell well when the structure is ready. Here a designer agent files 24 raw items into folders, and a separate tester agent checks the structure against a clear definition of good enough: the right place for at least 9 of 10 tasks. There is no strict check of a structure, but a model can assess one well when it knows what good enough means. The same loop works for nearly anything that can be checked: the feedback lets the agent improve its work, and the bar says when to stop.

The example calls a paid API with your own key: `OPENROUTER_API_KEY` (used first) or `OPENAI_API_KEY`. One run of each mode is 6 to 10 requests, under 1 cent with the default model.

## Run

```bash
npx mex open structure-test-loop
npx mex run structure-test-loop
npx mex run structure-test-loop --runs 3 --misses
npx mex run structure-test-loop --mode loop --structure
npx mex run structure-test-loop --provider openai
```

- `--runs` sets the runs per mode, from 1 to 3 (default 1).
- `--mode once|rated|loop` runs one mode only.
- `--misses` prints every missed task: the tester's answer and the right place.
- `--structure` prints the folder tree of every round: what the designer changed since the round before, and the tester's marks (`✓` right, `✗` its wrong answer, `○` the right place). It also prints `map.md` of the last structure.

## What happens

1. `items.ts` holds 24 raw items of Tidewater Studio, a made-up design studio with three people. The items are meeting notes, decisions, contacts, how-tos, receipts and ideas. They are for two clients and for the studio. Each item has an id, `i01` to `i24`.
2. The designer gets all 24 items in one request. It returns a structure as structured output: a path for every item, the text of `map.md` and one template for new notes. The last paragraph of its instructions defines "good enough": a fresh agent that sees only `map.md` and the paths gets at least 9 of 10 tasks right.
3. `checkStructure()` in `structure.ts` parses the output and checks it with `check()` from `shared/json-schema.ts`. Then it checks the rules that the schema cannot check:
   - Every item has exactly one path, and no two items share a path.
   - Each path is safe and relative: lower case, in a folder, at most 4 parts with the file name, `.md` at the end, no `..`.
   - `map.md` has at most 2,000 characters, and the template is not empty.

   A structure that fails the check is a failed round. The tester does not test it, and it scores 0.
4. The tester is a separate request with no designer context. It sees `map.md` and the sorted list of paths, never the items. It answers all 10 tasks in one structured request, with one path for each task. It gets no feedback between tasks, so the request sends the map and the paths once, not ten times.
   - 6 **find** tasks describe an existing item in other words, for example "Who to text when the heating fails." The right answer is the path that the designer gave that item.
   - 4 **file** tasks give a new item that has a twin among the 24 items: the same kind, client, vendor and month. The right answer is a new file in the folder of the twin. An existing path is a miss, because a new note there would overwrite a note.

   The answer key names items, not paths. So it works for every structure that the designer can make.
5. The example runs three modes:
   - **One shot**: one structure, one test.
   - **One shot, self-rated**: the same. The designer also returns `self_rating`: the number of tasks it expects the tester to get right, and whether the structure is ready.
   - **Test loop**: after a round below good enough, the designer gets its last structure back with the feedback. The feedback is the check errors, or the missed tasks with the tester's answer and the right place. The designer returns a revised structure. The loop stops at 9 of 10 or after 3 rounds. A run keeps the last structure that passed the check.
6. `tree.ts` turns the structure of each round into a folder tree. It compares the tree with the structure of the round before and marks what the designer changed: a new, renamed, moved or removed folder, a moved or renamed file, an edited `map.md`. A folder that keeps all its notes under a new path counts as renamed or moved, not as new. It also puts the tester's checks on the tree: `✓` where the tester answered right, `✗` where it answered wrong, and `○` the right place of a task that it missed. A path that the tester made up shows as a dashed row under its nearest folder.
7. The CLI prints every round of every run, and with `--structure` the tree of each round. Then it prints, per mode: the measured score, rounds, self-rating, requests, tokens, cost and model time.
8. The page shows the definition of good enough and the 10 tasks before you run. After the run, it shows the measured score of each mode, with the self-rated designer's claim next to its score. Below that is how the structure was built: pick a mode and a round, and see that round's tree with its change marks (blue) and the tester's checks (green and red), next to the list of tasks. Hover a task to find its marks in the tree. Folds hold `map.md`, the feedback to the designer, the template and every request.

What we saw on OpenAI with the default model, 6 runs per mode (two batches of 3, about $0.014 per batch):

| Mode | Measured score per run | Good enough | The designer said |
|---|---|---|---|
| One shot | 7, 6, 10, 5, 7, 7 | 1 of 6 | – |
| One shot, self-rated | 6, 7, 7, 7, 9, 6 | 1 of 6 | 10, 9, 9, 9, 9, 9, "ready" every time |
| Test loop | 6, 8, 9, 9, 9, 8 | 3 of 6 | – |

The designer called its structure ready in all 6 runs and expected 9 or 10 of 10. The tester measured 6 to 9, so the rating was right once. The designer's reasons are about what a designer can see: clear folders and filing rules. The designer cannot see a reader who has only the paths.

In the 12 one-shot runs, the tester missed "Who to text when the heating fails" 9 times. It missed "The day of the month by which receipts must be handed in" 10 times. Both answers are in contact notes with the name of a person (`contacts/greta-lind.md`, `contacts/henrik-dahl.md`). The role that the task asks about is only in the note. The tester also filed the Linden drawing club idea in a different folder than the lettering workshop idea 9 times. It named an existing note as the place for a new how-to 3 times.

The loop did not fix everything. Its first round is a one shot (7, 8, 7, 8, 6 and 7). The revisions raised that score in 4 of 6 runs, kept it the same in 1 and lowered it in 1. 3 runs were good enough. 16 rounds took 29 requests, about 2.5 times the cost of a one shot. Three revisions made `map.md` longer than 2,000 characters and failed the check. One run scored 8 in all 3 rounds: its last revision fixed the two misses and broke two other tasks.

Be careful with the wins too. The loop sees the same 10 tasks in every round, and the feedback names the right paths. In the revisions of the first batches, the contact notes kept their names. The designer wrote the answers into `map.md` instead: "Greta Lind, landlord: rent and heating issues, including whom to text (studio/contacts/greta-lind.md)". In two later loop runs, the tree shows the other fix: the revision renamed the two contact notes after the tasks, for example `greta-lind.md` to `landlord-heating-sms.md` and `henrik-dahl.md` to `accountant-receipts-by-5th.md`. Both fixes pass the test. They help a later reader only with the questions that the test asked, and a fix in the map makes the map longer.

Scores change from run to run. An earlier batch of 6 runs per mode used a looser path rule in the instructions. It measured 44 of 60 for one shot and 40 of 60 for self-rated (again "ready" every time). The loop measured 56 of 60 and was good enough in all 6 runs. Compare several runs.

## Try this

- Write two new find tasks in `items.ts` that the loop never sees in feedback. For example: "The contract number for the printer repairs." (`i16`) and "What new clients pay per day next year." (`i23`). Set `BAR` in `loop.ts` to 11, and run `--mode loop --runs 3 --misses`. Does the revised structure answer the new tasks too, or only the tasks in the feedback?
- Delete the last paragraph of `DESIGNER_INSTRUCTIONS` in `loop.ts`: the definition of good enough. Run `--mode rated --runs 3`. Does the self-rating change? Does the measured score change?
- Add this line to the designer instructions: "Name a contact note by the person's role first, for example `landlord-greta-lind.md`." Run `--mode once --runs 3 --misses`. Do t01 and t02 stop failing in the first round?
