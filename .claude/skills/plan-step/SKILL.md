---
name: plan-step
description: "Run one step of docs/PLAN.md through a test-first, human-reviewed PR cycle: pick the next open step, write failing tests, implement, verify tests, lint and types, open a PR, and list exactly what a human should check. The step is merged and marked done only when the user runs /plan-step approve."
argument-hint: "[step number | approve | changes <feedback> | status — omit for the next open step]"
disable-model-invocation: true
---

# plan-step

Arguments: `$ARGUMENTS`

`docs/PLAN.md` is the source of truth. Its `## Status` checklist says which steps are done. The user has to review and defend every step in a technical interview, so this skill's job is to hand over small, honest PRs and never to merge on its own judgment.

**Commits and PRs:** make every commit by staging the files and invoking the global `commit` skill. No commit or PR may carry Claude attribution: no `Co-Authored-By` lines and no "Generated with Claude Code" footers.

## Choose the mode

First read `docs/PLAN.md` in full, then run:

```bash
gh pr list --state open --json number,title,headRefName,url --jq '[.[] | select(.headRefName | startswith("step/"))]'
```

| Argument | Open step PR exists? | What to do |
|---|---|---|
| none or a step number | Yes | Don't start new work. Show the PR link and its review checklist, and remind the user of `/plan-step approve` and `/plan-step changes <feedback>`. |
| none | No | Run the first unticked step in `## Status`. |
| a step number | No | Run that step. If an earlier step is unticked, stop and ask first. |
| `approve` | Yes | Follow "Approve". |
| `changes <feedback>` | Yes | Follow "Changes". |
| `status` | Either | Report the checklist and any open PR, and change nothing. |
| `approve` or `changes` | No | Say there's no open step PR, and stop. |

## Run a step

### 1. Prepare

- Stop if the working tree is dirty, and show the user what's there. Don't stash or discard it.
- Update `main` with `git switch main && git pull --ff-only`, then create `step/<n>-<short-slug>`.
- Gather the step's context: its entry in `## Implementation steps`, the matching parts of Decisions, Typing rules, Database layer rules, Behaviour details and Verification, and `## Implementation log`.
- Stay inside the step. If it's wrong, blocked or much bigger than described, stop and explain. If a design decision comes up that the plan doesn't settle, lay out the alternatives and let the user choose, because they need to be able to defend it.

### 2. Write failing tests

- Derive tests from the plan and the brief (`instructions.md`), not from the implementation you have in mind.
- Add only the type signatures and empty stubs needed to compile.
- Run the tests and confirm each new one fails on an assertion because the behaviour is missing. A compile, import or setup failure proves nothing, so fix that and run again.
- Commit the tests and stubs on their own. This commit is the record of what was specified before implementation. Note its hash.
- Steps the plan marks as having no tests of their own follow the plan's stated check instead.

### 3. Implement

- Write the code until the tests pass, following the plan's typing and database rules.
- Use batch operations rather than awaiting row by row in a loop. Await in a loop only when the work must run in sequence.
- Commit the implementation.

**When a test fails, fix the code, not the test.** Don't weaken, skip, delete or edit a test to get a pass. If a test really looks wrong against the brief, stop, show the user why, and change it only once they agree.

### 4. Verify

Run all of these and keep the real output. Don't use `--no-verify`, and don't suppress type or lint errors to get a pass.

```bash
npm run verify                                     # types, lint, all tests
git diff --stat <test-commit>..HEAD -- '*.spec.*' '*.test.*'   # must be empty, or each change explained
```

Also run the step's end-to-end checks from the plan, using the `browser-automation` skill for UI steps. If anything fails or can't be run, say so plainly in the PR. Don't open a PR that claims a pass you didn't see.

Don't call real LLM providers unless the user asks, since those calls cost money. Never print or commit `.env` contents.

### 5. Open the PR

Push the branch and open a PR titled `Step <n>: <name>`, with this body:

```markdown
## What this step does
<2-3 sentences>

## Test-first evidence
- Tests commit: <hash>
- Failing run: <n failed, with a short excerpt showing assertion failures>
- Passing run: <n passed>
- Test changes since the tests commit: <none, or each change and why the user agreed>

## Verification
| Check | Result |
|---|---|
| Types | ... |
| Lint | ... |
| Tests | ... |
| End-to-end | ... |

## Human review checklist
<see below>

## Deviations from the plan
<none, or what changed and why>
```

### 6. Write the human review checklist

This is the most important part of the hand-off. Include only what this step actually needs, specific enough to act on without reading the whole diff:

- **Run this:** exact commands, with what the user should see.
- **Read this:** `file:line` for the few places where a mistake would matter most, and what could go wrong there.
- **Decide this:** judgment calls you made that the plan didn't settle, with the alternative you rejected.
- **Not proven:** what the tests and checks don't cover, such as real provider behaviour or production settings.
- **Be ready to explain:** the design points from this step an interviewer may probe, with a one-sentence answer.

Avoid generic items like "check code quality". If you verified something yourself, report it under Verification rather than handing it to the user.

Then reply with the PR link, the checks and their results, and the checklist, and end with:

> Run `/plan-step approve` to merge and mark this step done, or `/plan-step changes <feedback>` to request changes.

Then stop. A casual "looks good" isn't approval; if the user says something like that, ask them to run the command.

## Changes

1. Switch to the PR branch and apply the feedback. New or changed behaviour gets a failing test first, as in "Write failing tests".
2. If the feedback is a question, answer it and change nothing unless asked.
3. Add new commits, without rewriting history, so the user can see what changed since their review.
4. Run "Verify" again, update the PR body, and reply with what changed and an updated checklist. The step stays unapproved.

## Approve

Only this mode merges, and only when the user invoked it with `approve`.

1. Switch to the PR branch. Confirm the PR is open and mergeable, and stop if it isn't.
2. Run `npm run verify` again. If it fails, stop and report; don't merge.
3. Update `docs/PLAN.md` on the branch:
   - Change `- [ ] Step <n>` to `- [x] Step <n>` in `## Status` and add the PR number.
   - Add any facts later steps need, plus any deviations, to `## Implementation log`.
   - If this step changed a later step, edit that step and mark it `(updated by step <n>)`.
4. Commit this update, and push.
5. Merge with `gh pr merge <number> --merge --delete-branch`. Use a merge commit rather than a squash, so the test-first history stays visible.
6. Update local `main` with `git switch main && git pull --ff-only`.
7. Reply with the merged PR, and the next open step with what it will do. Don't start it until the user runs `/plan-step` again.
