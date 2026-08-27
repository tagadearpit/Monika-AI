---
name: verify-before-claiming
description: Use this skill for any bug fix, refactor, or logic change involving text processing, parsing, string manipulation, streaming/async state, or any code where correctness depends on more than the "normal case" input. Also use it before claiming a task is fixed, tested, or complete, and before any commit/push. Triggers on requests like "fix this bug", "why is X slow/wrong/dropping data", "implement Y", "is this done", "commit and push".
---

# Verify Before Claiming

## Goal
Prevent two specific failure patterns this project has hit before:
1. Shipping a fix based on hand-traced reasoning ("here's why this works") that turns out to be wrong on inputs the trace didn't cover — e.g. a sentence-splitting regex that silently dropped text around decimals like "9.5", which survived two rounds of confident manual walkthroughs before an actual executed test caught it.
2. Bundling unrelated changes into one commit because they were touched in the same session — e.g. shipping a UI feature alongside a bug fix without flagging that it wasn't asked for.

## Instructions

### Before claiming any fix is correct
- Do not conclude a fix is correct from reading the code or tracing 2-3 examples by hand. Hand-traced examples systematically miss edge cases — treat "I traced through it and it works" as a hypothesis, not a result.
- Write and RUN an actual test that exercises the property you're claiming, not just the happy path. For parsing/splitting/chunking logic specifically: assert that reconstructing the output covers 100% of the input with no gaps or duplicates, across multiple input variations (punctuation edge cases, boundary conditions, empty/minimal input) - not just one sample.
- For anything involving streaming, async ordering, or state that changes incrementally (deltas, chunks, partial data arriving over time): simulate the incremental arrival explicitly (e.g. feed input in small increments of varying sizes) rather than only testing against the final, complete input. Bugs in incremental logic often don't show up when tested against complete input in one shot.
- Report test results as "ran X, got Y" with actual output shown, not "this should work" or "this correctly handles X".

### Before every commit or push
- List every file changed and confirm each change maps to the specific task that was asked for. If a change doesn't map to the current task, stop and flag it explicitly before including it — do not silently bundle it in.
- If you notice an unrelated improvement worth making while working (e.g. a UI issue, a missing feature), mention it separately and ask before including it in the same commit. Never combine an explicitly-requested fix with a self-initiated addition in one commit.
- State plainly what was NOT verified (e.g. "not tested against a live API/browser, only simulated" or "existing behavior X wasn't re-checked") rather than implying full coverage.

## Constraints
- Do not say "tests pass" or "this is fixed" without having actually executed a test in this session and shown its output.
- Do not claim a design is "safe against X" based on a written-out example alone — back it with an executed check, or explicitly label it as unverified reasoning.
- Do not include scope beyond what was asked for in a commit without surfacing it as a separate, callable-out addition first.
