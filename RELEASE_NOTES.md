# 2026.10-rc2 - educational review candidate

> **Educational work by a pre-medical student — not medical advice.** Not a clinical protocol, prescription, or patient handout, and not for patient care. See [DISCLAIMER](DISCLAIMER.md).

Revised 27 October 2026 after the rc1 PRs were merged.

This pass corrects newly identified source and software defects and deliberately narrows unsupported clinical/methodological content. Earlier versions remain recoverable in Git history. See PUBLICATION_REVIEW.md for the precise scope and limitations, PROVENANCE.md for author statements, and RELEASE_MANIFEST.json for current-file hashes.

The candidate is not a clinical protocol, validated controller, systematic/scoping review certification, or legal opinion. No repository visibility change is included.

## Teaching supplement — 27 October 2026
Added paired fictional male/female software walkthroughs and higher-risk variants, DOI-linked clinical context, unit arithmetic, decision flows, actual output records and an executable reproduction harness. Existing controller logic, manuscript text and PDF exports are retained. The supplement documents incomplete hold behavior rather than claiming a comprehensive shutdown. All 31 existing tests pass and the four traces plus exact-boundary example reproduce. Repository visibility is now public at the author request.

## Multimodal anesthesia options — 28 October 2026
Added an educational comparison of four anesthesia options, six synthetic male/female case pairs (12 cases), two decision flows and a DOI source map. Corrected IV maintenance, MAC/sedation-depth, blocker reversal and regional-adjuvant distinctions. Existing manuscript/PDF content, controller logic and configuration are retained; no new controller capability or clinical validation is claimed.

## Clinical example rollout — 28 October 2026
Added shared documentation standard and portfolio case index; existing model walkthroughs, code, configuration, manuscript and PDFs retained.


## 29 October 2026 — Portfolio presentation and reading path

Added a concise reader’s guide, explicit AI-assistance/authorship scope and review-status notes. Linked the portfolio home and corrected navigation wording. This presentation pass preserves substantive manuscripts, casebooks, code and existing exports. Repository visibility is unchanged.

## Safety-hardening pass — November 2026 (local branch, pending owner review)
An adversarial simulation of 34 scenarios found software defects that contradicted the documentation. They are fixed below; behavior for valid inputs is unchanged, and `EXAMPLE_RESULTS.json` reproduces exactly.
- **Unusable sensor values now fail safe.** A NaN reading had passed every `<` comparison and displayed GREEN, and a missing value crashed the loop with infusions still set. All values are now zeroed and the hold latches.
- **Lockouts and latched holds are enforced every iteration.** Previously they applied only when starting rates were generated, so a directly written rate bypassed them, and HOLD could display while an agent was running.
- **Added `simulation_rate_ceilings` to the configuration.** Starting values above a ceiling are rejected at load. Negative, non-finite or over-ceiling runtime rates are zeroed and the hold latches.
- **Contraindication matching is now case-insensitive substring matching.** Previously, "heart block", "Complete heart block" and "nsaid" were missed. "Mobitz" was added to the illustrative cardiac list.
- **Ages above 120 are rejected.** Duplicate ketorolac lock entries were removed.
- **Tests:** 44 tests pass (31 existing plus 13 new in `test_safety_hardening.py`).
- **Not changed (owner decisions):**
  - which agents each hold stops
  - high HR/MAP monitoring
  - the dosing-weight scalar
  - NSAID cross-reactivity terms
  - ketamine and lidocaine rules
  - stale-data detection
  - PK parameters: the implied dexmedetomidine half-life is about 17 min vs about 2 h in labeling
- **The PDF has not been rebuilt** to reflect these changes.
