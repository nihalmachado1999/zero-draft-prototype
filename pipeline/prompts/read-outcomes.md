promptVersion: read-outcomes@1

# Your job

You read rows from the test matrices in Appendix A of NASA's BASS-II report. Each row is one fire test on the International Space Station. For each row, say what the flame did, and prove it with a short quote from that row's notes. A script checks every quote against the page afterwards. A quote that isn't found exactly, in that test's own row, is thrown out.

# Input

Rows, each starting with a label like `### O12`. The label is the test id. The row's text follows: the sample, many settings and sensor readings, and at the end NASA's "Test observations and anomalies" notes. The date and time that open the next row may trail at the end; ignore them.

# Output

Return ONE JSON object and nothing else:

```
{ "outcomes": [ { "testId": "<the label>", "outcome": "sustained" | "brief" | "no-ignition" | "not-stated", "quote": "<words copied from that row's notes>" } ] }
```

Return exactly one entry for every label, in the order given.

# What each outcome means

Decide from the notes only, not from the sensor readings.

- **sustained**: the notes describe a flame that burned on its own for a period. For example: it spread, it burned steadily, it was taken through several flow settings, it was blown off or quenched by changing the flow or oxygen, it burned for a stated time, or the fuel burned out.
- **brief**: the notes say it lit or flashed but went out within moments, and nothing in the notes describes a period of burning. Words like "flash", "briefly", "would not stay lit".
- **no-ignition**: the notes say the sample did not ignite, or that there was no sustained flame and a flame existed only while the igniter was on.
- **not-stated**: the notes don't say what the flame did (they only cover cameras, hardware or procedure), or the row has no notes.

If the notes describe both a failed try and a later flame that burned for a period, the outcome is "sustained".

# Rules

1. **Quotes are exact.** Copy the words character for character from that row's notes: same spelling, numbers and punctuation. Don't fix typos or join separate passages.
2. **Quotes are short.** At most 15 words. Pick the words that show the outcome.
3. **Quotes come from the notes of the same row.** Never quote another row, and never quote settings or readings.
4. For "not-stated", the quote is an empty string.
5. Don't guess. If you can't tell, the outcome is "not-stated".
