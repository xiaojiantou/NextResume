# Dense measurement content calibration

`dense-measurement-cases.json` contains eight independently authored fictional
source/candidate pairs. The preferred labels were assigned before running the
current reviewer. They test whether clearer expression preserves the evidence
already present in a dense bullet. They are development calibration and
regression cases, not a held-out benchmark or evidence of customer uplift.

Two candidates should be accepted for a concrete clarity gain, one unchanged
strong original should be retained, and five candidates should be rejected for
lost or altered evidence. `retain` means select the source over this candidate;
it does not mean the source cannot benefit from a different faithful rewrite.
No label prescribes a retry, an evidence question, or an implementation strategy.

| Case | Label | Reason |
| --- | --- | --- |
| `dense-faithful-task-opening` | improved | Removes first-person responsibility scaffolding while preserving the action and every measurement clause verbatim. |
| `dense-lost-comparison-set` | retain | Keeping the worker count and parser version fixed does not preserve the separate condition that both replays use the same document set. |
| `dense-lost-sample-denominator` | retain | The pass counts remain, but dropping the total of 480 receipts removes the denominator needed to interpret them. |
| `dense-estimate-presented-as-measured` | retain | Recasts an approximate team estimate based on remembered durations as a measured outcome and removes its qualification. |
| `dense-strong-measured-original` | retain | Already communicates the monitoring contribution, approximate monthly input/output volumes, and log-based evidence clearly; unchanged text is not an improvement. |
| `dense-qualitative-task-clarity` | improved | Removes responsibility scaffolding while preserving the documented task and actual use of the guide; no number or stronger outcome is needed. |
| `dense-preparatory-task-not-ownership` | retain | Investigation and a draft plan do not establish ownership, completed testing, or deployment; the source explicitly says the settings were not deployed. |
| `dense-input-output-volume-reassignment` | retain | Preserves the literal numbers and approximation but exchanges the input/output categories to which those volumes belong. |

The first two cases intentionally share a source and differ only in the
comparison-set clause. This prevents a blanket preference for either shorter
wording or exact source retention from satisfying both labels. The token-volume
case tests category attribution without introducing a new number, so numeric
membership alone cannot validate it. All other sources are distinct fictional
examples; none uses customer data.

Run the existing reviewer calibration without modifying production behavior:

```sh
mkdir -p eval/content/dense-measurement
node --experimental-strip-types scripts/eval-content.mjs --live --calibrate --cases eval/content/dense-measurement-cases.json --out-prefix eval/content/dense-measurement
```

The `--live` command uses the configured provider and incurs model usage. Without
`--live`, the script only loads the case file and reports its categories. Report
false acceptance, false rejection, and unavailable judgments separately. A high
agreement rate on these deliberately targeted cases cannot establish general
writing quality, and this reviewer calibration does not exercise generation,
the full optimization runner, or human preference.
