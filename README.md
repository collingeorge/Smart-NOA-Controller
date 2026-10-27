# Smart NOA: educational rule-checking simulation

> Independent educational work. Not a clinical protocol, prescription, patient handout, or validated decision aid. This revision is a draft pending clinical and publication review.

This Python program updates in-memory values using fictional profiles and randomly generated vital signs. It has no device interface, patient monitoring input, clinical validation, or basis for recommending doses. It is not an operational safety supervisor.

## Run and inspect

Use Python 3.10 or later. From this directory:

```sh
python -m pip install -r requirements.txt
python -m unittest discover -v
python smart_noa_controller.py
```

The demo uses fictional profiles and sleeps between iterations. Do not enter patient information, connect equipment, or interpret printed values as clinical advice.

## Implementation and limitations

- Reads illustrative values from config.yaml using PyYAML.
- Applies an incomplete set of example lockouts. No lockout does **not** mean a drug is safe. Unrecognized drugs return “unassessed.”
- Uses one central compartment and an effect-site state with an explicit Euler update. This is not a three-compartment model or target-controlled infusion implementation. Concentration units are numerically equivalent mcg/L and ng/mL. Parameters are unvalidated.
- Sets simulated values to zero at configured low-HR or low-MAP events. A hold remains latched; a subsequent normal reading does not restart values. No automated recovery policy is implemented.

Passing tests does not establish clinical efficacy or patient safety. The program does not model drug interactions, sensor failures, clinical workflows, all contraindications, or physiologic responses to the simulated values. Random vital signs do not depend on drug concentrations. Validation covers the fields used by this simulation; it does not establish clinical plausibility or suitability for safety-critical use.

No rate, threshold, or age adjustment is endorsed as a clinical recommendation. The former “100% prevention” statement is not retained. This project provides no evidence that it prevents adverse events.

## Regulatory and publication boundaries

[Current FDA CDS guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/clinical-decision-support-software) distinguishes software functions by intended use and statutory criteria. An educational disclaimer does not determine device status, exempt future clinical functionality, or establish a regulatory pathway.

[PUBLICATION_REVIEW.md](PUBLICATION_REVIEW.md) records unresolved review items. The PDF and architecture diagram are rebuilt from the current educational description; see [MANUSCRIPT.md](MANUSCRIPT.md).

## License and author

The software is under the [MIT License](LICENSE). Safety warnings describe intended use; they do not add field-of-use restrictions to MIT or promise immunity from liability. Third-party material retains its own rights.

Collin B. George, BS. Independent educational project; no institutional endorsement is claimed.
