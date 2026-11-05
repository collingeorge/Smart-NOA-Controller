# Development and verification scope

> **Educational work by a pre-medical student — not medical advice.** Not a clinical protocol, prescription, or patient handout, and not for patient care. See [DISCLAIMER](DISCLAIMER.md).
Run `python -m unittest discover -v` from the repository root after installing `requirements.txt`. Regression checks cover numerical mass balance, rejection of invalid numerical inputs, unknown-drug handling, and latched holds. `test_safety_hardening.py` adds checks for unusable vital-sign values, in-loop enforcement of lockouts and holds, simulation rate ceilings and case-insensitive matching. They are software checks, not clinical evidence.

Static analysis is configured in `pyproject.toml` (ruff: line length 120; rule sets E, W, F, B, UP, I, SIM, C4, S; per-file exceptions are listed there with their reasons) and can be reproduced with `ruff check .`, `pyflakes *.py`, `mypy --ignore-missing-imports *.py` and `bandit -c pyproject.toml -r .`. The web simulator's JavaScript lint is `cd simulator && npm run lint` (see `simulator/README.md`). The 2026-11 audit fixes and their tests are listed in `simulator/AUDIT_2026-11.md`.

The configuration is not a drug database. Its rates and thresholds are unvalidated. There is no sensor interface, clinical alarm architecture, drug interaction model, or evidence of improved patient outcomes. No clinical deployment or regulatory status is represented.

## Reproducible examples
Run `python example_walkthrough.py > EXAMPLE_RESULTS.json` from the repository root. The harness uses scripted readings and disabled sleeps to exercise the unchanged loop. It asserts simultaneous-alert behavior, persistence and scope of the hold, exact comparison boundaries, and unsupported-drug responses. It records sex/height as narrative metadata, not implemented model inputs.
