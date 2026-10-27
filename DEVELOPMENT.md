# Development and verification scope

> Independent educational work. Not a clinical protocol, prescription, patient handout, or validated decision aid. This revision is a draft pending clinical and publication review.

Run `python -m unittest discover -v` from the repository root after installing `requirements.txt`. Regression checks cover numerical mass balance, rejection of invalid numerical inputs, unknown-drug handling, and latched holds. They are software checks, not clinical evidence.

The configuration is not a drug database. Its rates and thresholds are unvalidated. There is no sensor interface, clinical alarm architecture, drug interaction model, or evidence of improved patient outcomes. No clinical deployment or regulatory status is represented.
