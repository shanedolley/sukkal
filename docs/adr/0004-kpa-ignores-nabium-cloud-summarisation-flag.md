# KPA ignores nabium's cloud summarisation flag

Nabium exists partly for data sovereignty: its build spec states that transcripts
of BHP Ironclad and Meridian workshops should not leave the device, it
transcribes on-device for that reason, and it gates cloud summarisation behind a
per-engagement `allow_cloud_summarisation` flag. KPA does not read that flag.
Content from every engagement reaches Claude or OpenRouter along with everything
else. Decided by Shane on 23 August 2026, after the alternative was raised.

## Considered Options

1. **Honour the flag strictly** - excluded engagements stored and keyword
   searchable but never reasoned over by a cloud model. Would have preserved
   nabium's guarantee end to end.
2. **Honour it and show what was lost** - as above, with the interface marking
   answers that are incomplete because an engagement was excluded, so a partial
   answer never reads as a complete one.

## Consequences

- The sovereignty guarantee ends at KPA's boundary rather than continuing through
  it. Nabium's local transcription still earns its keep, since it is already
  built and costs nothing to run, but it no longer protects the engagements it
  was written to protect once KPA ingests them.
- Nabium's `docs/employer-policy-checklist.md` is unsigned, and its message
  capture section asks the exact question this decision answers by default. Shane
  has decided the checklist is not a gate: he is the decision maker and accepts
  the exposure directly. Recorded here rather than chased.
- Reversing this later does not recall what has already been sent.
