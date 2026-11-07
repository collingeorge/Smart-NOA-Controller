# Smart NOA: educational rule-checking simulation

[Reader’s guide](START_HERE.md) · [Authorship & review status](AUTHORSHIP_AND_REVIEW.md) · [Disclaimer](DISCLAIMER.md) · [Portfolio home](https://collingeorge.github.io/CM-2026/)

> **Educational work by a pre-medical student — not medical advice.** Not a clinical protocol, prescription, or patient handout, and not for patient care. See [DISCLAIMER](DISCLAIMER.md).
This Python program updates in-memory values using fictional profiles and randomly generated vital signs. It has no device interface, patient monitoring input, clinical validation, or basis for recommending doses. It is not an operational safety supervisor.

## Web simulator

**[Launch the educational web simulator](simulator/index.html)**: enter a fictional patient, choose general anesthesia or MAC sedation, review sourced auto-filled doses, then run and adjust the case on a live monitor. Doses and their sources are listed in [simulator/SOURCES.md](simulator/SOURCES.md), and every model parameter with its provenance is in [simulator/MODEL_CARD.md](simulator/MODEL_CARD.md). It is an educational, label-calibrated simulation with fictional patients: not a medical device, not validated, and not for clinical decisions or dosing.

## Run and inspect

Use Python 3.10 or later. From this directory:

```sh
python -m pip install -r requirements.txt
python -m unittest discover -v
python smart_noa_controller.py
```

`python smart_noa_controller.py` runs three **scripted** scenarios (fixed, hand-written fictional vital signs, so every run is identical): a high-risk profile whose falling MAP latches a hold, a healthy adult whose dexmedetomidine model concentration rises until a gradual fall in heart rate latches a hold, and a heart-rate sensor fault that fails safe. It runs instantly; add `--realtime` for one second per simulated second. `monitor_and_control()` accepts optional `vitals` (scripted `(hr, map)` pairs), `sleep_sec` and `log_every`; without `vitals` it keeps its original random readings. Do not enter patient information, connect equipment, or interpret printed values as clinical advice.

## Paired examples and decision flow

Read [the synthetic male and female walkthroughs](GUIDELINE_INFORMED_EXAMPLES.md) for literature-supported dosing context, explicit unit arithmetic, actual software traces, decision flows, and the limits of each implemented safeguard. Four profiles and exact-threshold behavior are reproducible with `python example_walkthrough.py`; see [the recorded outputs](EXAMPLE_RESULTS.json). These examples do not change the control logic or authorize administration.

## Anesthesia options and procedure cases

[Compare anesthesia options, standards and twelve synthetic adult cases](ANESTHESIA_OPTIONS_AND_CASES.md): general, regional, procedural sedation/MAC and local anesthesia, with six male/female pairs, medication roles/routes, individualized alternatives and two discussion flows. This companion guide describes clinical concepts outside the implemented controller; it does not add drug or device capabilities.

## Implementation and limitations

- Reads illustrative values from config.yaml using PyYAML.
- Applies an incomplete set of example lockouts. No lockout does **not** mean a drug is safe. Unrecognized drugs return “unassessed.”
- Uses one central compartment and an effect-site state with an explicit Euler update. This is not a three-compartment model or target-controlled infusion implementation. Concentration units are numerically equivalent mcg/L and ng/mL. Parameters are unvalidated.
- Sets simulated values to zero at configured low-HR or low-MAP events. A hold remains latched; a subsequent normal reading does not restart values, and an agent zeroed by a hold (or hard-locked for the profile) is re-zeroed every iteration even if its in-memory rate is overwritten. No automated recovery policy is implemented.
- Releasing a hold takes two explicit, logged steps: `acknowledge_hold(by, note)` and then `resume_hold(by)`. The release is refused unless the current hold was acknowledged after its most recent latch event (a new trigger or a newly held agent cancels the acknowledgment; each acknowledgment is used once). Held values stay at zero after the release; nothing is restored. In a real supervisory system a licensed clinician would do this; here it is a simulated action. The hold keeps its trigger reasons (with times) until it is released, and a non-blocking note is logged every 10 simulated minutes while it stays latched.
- Fails safe on an unusable vital-sign value: all simulated values are zeroed and the hold latches. Unusable means missing, non-numeric, NaN, infinite or boolean; outside the `sensor_plausibility` limits in config.yaml (HR and MAP 0–300); or a one-second **drop** larger than 40 /min (HR) or 30 mmHg (MAP). These are simulation limits, not clinical standards; a sudden rise is not checked, and stale data and signal quality are **not** assessed.
- `suspend_interlocks(duration_sec, by, reason)` (1–300 s, `interlock_suspension_max_sec`; reason required) suppresses only the HR/MAP holds for a limited time: each breach is still logged as suppressed, and the suspension expires on its own (`end_suspension(by)` ends it early). The sensor fail-safe, rate ceilings, lockouts and any hold already latched are never suspended. A new controller is not suspended; a second suspension while one is active is refused.
- Every automatic zeroing, latch, acknowledgment, release, suspension start/end/expiry and suppressed breach is recorded in `controller.events` (simulated time, code, status, agents, exact reason), and the demo prints a short event log after each scenario. The web simulator reproduces the same codes and messages (parity test against `EXAMPLE_RESULTS.json`).
- Rejects configured starting values above `simulation_rate_ceilings`, and zeroes and latches any in-memory rate that is negative, non-finite or above its ceiling. These are software ceilings, not clinical maximum doses.
- Contraindication matching is case-insensitive substring matching against short illustrative lists; it is not a terminology service (e.g., an "Ibuprofen" allergy entry is not recognized as NSAID cross-reactivity).

Passing tests does not establish clinical efficacy or patient safety. The program does not model drug interactions, sensor failure modes beyond unusable, out-of-range or suddenly dropping values, clinical workflows, all contraindications, or physiologic responses to the simulated values. High heart rate or blood pressure is not monitored. Doses use total body weight with no dosing-weight scalar. Random vital signs do not depend on drug concentrations. Validation covers the fields used by this simulation; it does not establish clinical plausibility or suitability for safety-critical use.

No rate, threshold, or age adjustment is endorsed as a clinical recommendation. The former “100% prevention” statement is not retained. This project provides no evidence that it prevents adverse events.

## Regulatory and publication boundaries

[Current FDA CDS guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/clinical-decision-support-software) distinguishes software functions by intended use and statutory criteria. An educational disclaimer does not determine device status, exempt future clinical functionality, or establish a regulatory pathway.

[PUBLICATION_REVIEW.md](PUBLICATION_REVIEW.md) records unresolved review items. The PDF is rebuilt from [MANUSCRIPT.md](MANUSCRIPT.md); its filename (`…Deterministic_Closed_Loop_Safety_Controller.pdf`) is historical and kept so existing links work. The software is a rule-checking simulation, not a closed-loop safety controller.

## License and author

The software is under the [MIT License](LICENSE). Safety warnings describe intended use; they do not add field-of-use restrictions to MIT or promise immunity from liability. Third-party material retains its own rights.

Collin B. George, pre-medical student. Independent educational project; no institutional endorsement is claimed.

## Portfolio-wide applied learning

The [example format and verification standard](CASE_EXAMPLE_STANDARD.md) and [clinical example index](CLINICAL_EXAMPLE_INDEX.md) connect this simulation to the topic-specific casebooks across the clinical education portfolio. The shared format documents reasoning and evidence applicability; it does not validate the simulator or turn its outputs into clinical doses.
