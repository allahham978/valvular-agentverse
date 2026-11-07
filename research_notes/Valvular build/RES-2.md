# RES-2: `gemini-4-argon` tool-call reliability and speed

Tested 7 Nov 2026 through `generateContent` (non-streaming). Fake tools and fake hearts only.

**Short answer:** the agent design holds at thinking level `low`, with a 60-second step timeout and one retry. Tool calls were valid every time. The weak spots are occasional long stalls, and speed, which is too slow to run the full loop live inside a 4-minute pitch.

## What was tested

- **Runs:** 20 Breaker-style tool loops, one at a time: 8 low, 8 medium, 4 high. Levels were interleaved so time of day wouldn't skew them. Each level was split evenly across `AUTO` and `ANY` modes and two valves.
- **Tools:** `evaluate_design`, `group_failures`, `profile_group` and `report_findings`, running the PRD's placeholder rules on 400 seeded fake hearts.
- **Guardrails copied from the PRD:** evidence IDs, rejection of numbers not in cited evidence, and a turn budget (10 model steps per run). Rejected calls went back to the model as errors.
- **Success:** `report_findings` was accepted within budget.
- **Client timeout:** 120 seconds per request, with no retry after a timeout. Retries for 429 and 5xx were in place but never used.

Files are in `res-2/`: `run.mjs`, `summarize.mjs`, `runs.jsonl` (raw), `summary.json`, `diag.jsonl`, `smoke.json`, `all.log`.

## Results

| | low | medium | high | all |
|---|---|---|---|---|
| Runs succeeded | **8/8** | 6/8 | 2/4 | 16/20 |
| Failures | none | 2 timeouts | 1 timeout, 1 turn budget | 3 timeouts, 1 turn budget |
| Model steps per run, median / max | 4 / 5 | 4 / 4 | 7 / 10 | 4 / 10 |
| Tool calls per run, median / max | 9 / 10 | 9 / 10 | 21.5 / 29 | 9 / 29 |
| Step latency, median | 9.9 s | 10.2 s | 16.6 s | 11.2 s |
| Step latency, 90th percentile | 26.1 s | 21.5 s | 65.6 s | 34.7 s |
| Slowest completed step | 47.4 s | 49.7 s | 98.4 s | 98.4 s |
| Requests timed out at 120 s | 0/32 | 2/30 | 1/30 | 3/92 |
| Run time, median / max | 47 s / 75 s | 63 s / 151 s | 217 s / 314 s | 62 s / 314 s |
| Cost per run | $0.037 | $0.036 | $0.200 | $0.069 |
| Largest prompt | 5.8k tokens | 6.7k tokens | 27.6k tokens | |

Latency figures cover completed steps only, so the 3 timeouts are not in them. Run-time figures do include them.

**Sample size matters.** 8/8 still allows a true success rate as low as 63% (95% interval). The low and medium gap is not statistically meaningful, and the timeouts may be unrelated to thinking level, so assume low can stall too. Only high is clearly worse: slower, 5 times the cost, and more than twice the tool calls.

### Invalid calls

| Kind | low | medium | high | Meaning |
|---|---|---|---|---|
| Malformed or wrong arguments | 0 | 0 | 0 | 234 tool calls, none broke the schema |
| Unknown tool | 0 | 0 | 0 | |
| Empty or malformed response | 0 | 0 | 0 | |
| Text-only stop in `AUTO` | 0 | 0 | 0 | |
| Unknown evidence ID | 0 | 0 | 0 | |
| Design rule rejected (size over 2.5 mm) | 0 | 0 | 9 | The model trying wider sizes; the tool refused them correctly |
| Unknown heart ID | 0 | 0 | 1 | The ID wasn't logged, so its cause is unknown |
| Number not in cited evidence | 8 | 6 | 3 | **Mostly my test's fault, see below** |

### The number guard misfired

15 of the 18 runs that tried a report had at least one rejected. Rejected text wasn't logged in the 20 runs, so I ran 3 extra low runs that logged it ($0.12). All 3 rejections were false alarms: the model quoted band labels such as `16-18` and `1-1.1`, which are in the evidence as text, and my check only collected numeric values.

This almost certainly explains many of the 17, but only those 3 were seen directly. It means the table is somewhat pessimistic:
- Most low and medium runs would likely have finished one step sooner.
- Run-05 timed out on the step after a rejected report, so it might have passed.
- Run-12 had 2 reports rejected before hitting the turn budget, so it might have passed too.

I did not change the numbers above or rerun the set, to keep it cheap.

The guard also only checks that a number appears in the evidence, not that it's used correctly. The diagnostic reports read sensibly, but the guard could not have caught a misattributed figure.

### Tool behaviour that affects the design

- **Parallel calls are the norm:** 53 of 89 steps returned several calls at once. The adapter must run them all and send the results back together.
- **Thought signatures are mandatory:** removing them returned HTTP 400, "Function call is missing a thought_signature in functionCall parts". Each step carried exactly one signature, including parallel steps. Resend the model's `content` object unchanged, and echo each call's `id`.
- **`AUTO` and `ANY` performed alike:** 8/10 each. `ANY` is still safer, because a turn can then only end through `report_findings`.
- **Low and medium barely adapt:** at low, 7 of 8 runs did the same thing on both valves: one evaluate, three groups, three profiles, then report. Medium varied a little more, and high varied a lot. The test's two valves were similar and the fake tools were simple, so real tools may vary more. **This puts REQ-10 check 5 ("different tool sequences, not one fixed script") at risk.**
- **Latency isn't tied to output size:** identical-looking steps of about 500 output tokens took 8 seconds in some runs and 47 to 50 seconds in others. High's slowest steps were different: 8,700 to 9,300 thinking tokens on a final report.

### Rate limits

- **429 responses:** none in 92 requests. This run was sequential and peaked at about 7 requests and 29k tokens a minute, so it did not test the limits. I didn't probe for them, to keep it cheap.
- **Published limits:** the rate-limit docs give no requests-per-minute or tokens-per-minute figure for this model on any tier. The only Argon figure is Batch enqueued tokens (1 billion on tier 3). The docs also say limits aren't guaranteed.
- **Headers:** responses carried no rate-limit headers.
- **Our tier is unconfirmed:** the API doesn't report it. **A human should check the [rate limit page](https://aistudio.google.com/rate-limit) and [projects page](https://aistudio.google.com/projects).** Docs list tier 3 as $1,000 paid plus 30 days.
- **Expected need:** one sequential demo at low is well under 10 requests a minute, so limits are unlikely to matter unless several live runs overlap.

### Docs requirements

- REST thinking setting: `generationConfig.thinkingConfig.thinkingLevel` (`low`, `medium`, `high`; default medium). `thinkingBudget` is legacy.
- Set `maxOutputTokens` to at least 32,768. This is a ceiling, and thinking counts toward it. The model reports 32,768 as its output limit, which matches the non-streaming cap.
- Temperature and other sampling settings are ignored. Explicit caching is unsupported. Implicit caching showed up in the test runs without any setup.
- Keep to 10-20 active tools (the PRD has 11 in total). Very large schemas in `ANY` mode can return 400; this one didn't.
- The docs advise HTTP timeouts of at least 20 minutes, aimed at long generations. **I recommend going against this for the demo**, because a judge can't wait through a stall. Nothing here needs long generation.
- Price: $2 input and $10 output per 1M tokens through 30 Nov 2026, then $4 and $20. Thinking is billed as output. Not available on the free tier.

## What this doesn't show

- **Whether stalls recover.** The 3 timeouts were cut off at 120 seconds, so they could be hangs or just very slow. Whether a retry succeeds is untested.
- **The Fixer and the attack loop.** Only a Breaker-style turn was tested.
- **Real tools.** Bigger results will mean bigger prompts and possibly slower steps.
- **Streaming, the Interactions API, and the PRD's fallback model.** None were tried.

Total spend was about $1.55, including the smoke run, signature probe and diagnostic runs.

## Decision

**The agent design holds.** Keep Gemini tool calling, code-run loops and the guardrails as written in PRD section 3. Replay stays a required backup, not an optional one.

**Live settings for REQ-10:**

| Setting | Value |
|---|---|
| Model and API | `gemini-4-argon`, `generateContent`, non-streaming |
| Thinking level | `low` (not high) |
| Tool mode | `ANY`, with `report_findings` and `submit_proposal` as the only ways to end a turn |
| `maxOutputTokens` | 32768 |
| **Step timeout** | **60 s, then one retry of the same request.** Slowest completed low or medium step was 49.7 s |
| On 429 or 5xx | One retry, honouring any `retryDelay` |
| If the retry fails | Fail the run clearly and offer the recording (REQ-17) |
| Budget per agent turn | 8 model steps, 16 tool calls, 180 s. Low peaked at 5 steps, 10 calls and 75 s |

**Changes REQ-10 and REQ-11 must include:**
1. Run every parallel call and return the results together, resending the model's `content` unchanged so signatures survive.
2. Make the number guard read numbers inside text in the evidence too, such as `16-18`. Otherwise it rejects correct reports. Return rejections to the model and allow 3 report attempts.
3. Log rejected text, so false rejections can be told from real ones.
4. Watch REQ-10 check 5. If the Breaker runs the same sequence on both valves at low, try `medium` first, as it costs about the same here. Don't use `high`. If it still fails, make the two test valves differ more.
5. Confirm the retry with the `@live` 10-run test in REQ-10, and record the slowest time.

**For the pitch:** a single Breaker turn takes about 1 minute (75 s at worst). Break, Fix and attack would be at least 3 agent turns, so I estimate roughly 2.5 to 6 minutes, which won't fit a 4-minute pitch. This is an estimate, as the Fixer wasn't tested. Show one live Breaker turn and use labelled replay for the rest.

## Sources

- [Latest model guide](https://aistudio.google.com/docs/latest-model?generate-content=true&authuser=4)
- [Function calling](https://aistudio.google.com/docs/function-calling)
- [Thinking](https://aistudio.google.com/docs/thinking)
- [Thought signatures](https://aistudio.google.com/docs/thought-signatures)
- [Rate limits](https://aistudio.google.com/docs/rate-limits)
- [Pricing](https://aistudio.google.com/docs/pricing)
