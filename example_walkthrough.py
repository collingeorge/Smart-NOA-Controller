"""Reproduce fictional examples of existing code; not clinical dosing advice."""
import contextlib
import io
import json
from pathlib import Path
from unittest.mock import patch

from smart_noa_controller import Patient, SmartNOAController

CONFIG = str(Path(__file__).with_name('config.yaml'))


class WalkthroughCheckError(RuntimeError):
    """Raised when a reproduced example no longer matches the documented behaviour."""


def check(condition, message):
    """Explicit check that is never stripped by `python -O` (unlike `assert`)."""
    if not condition:
        raise WalkthroughCheckError(message)


def scenario(label, sex, height_cm, age, weight_kg, egfr, conditions):
    with contextlib.redirect_stdout(io.StringIO()):
        c = SmartNOAController(Patient(age, weight_kg, 3 if conditions else 2, egfr, [], conditions), CONFIG)
        starting = c.generate_starting_rates()
        trace = []
        for hr, map_value in [(80, 80), (40, 50), (80, 80)]:
            before = dict(c.infusions)
            seen = len(c.events)
            with patch('smart_noa_controller.random.randint', side_effect=[hr, map_value]), \
                    patch('smart_noa_controller.time.sleep'):
                c.monitor_and_control(1)
            trace.append({
                'step': len(trace) + 1, 'hr': hr, 'map_mmHg': map_value,
                'rates_before': before, 'rates_after': dict(c.infusions), 'status': c.status,
                'hold_latched': c.hold_latched, 'Cp_ng_mL': c.dex_pk.Cp, 'Ce_ng_mL': c.dex_pk.Ce,
                'events': c.events[seen:],
            })
        regenerated = c.generate_starting_rates()
        check([x['status'] for x in trace] == ['GREEN', 'RED', 'HOLD'], f'{label}: unexpected status sequence')
        check(trace[1]['rates_after']['Dexmedetomidine'] == 0, f'{label}: dexmedetomidine not zeroed')
        check(trace[1]['rates_after']['Lidocaine'] == 0, f'{label}: lidocaine not zeroed')
        check(trace[1]['rates_after']['Ketamine'] == 0.2, f'{label}: ketamine changed')
        check(all(value == 0 for value in c.infusions.values()), f'{label}: regenerated rates not zero under hold')
        check([e['code'] for x in trace for e in x['events']] == ['hr_low', 'map_low'],
              f'{label}: unexpected event log')
        unsupported = {drug: c.check_contraindication(drug) for drug in ['Propofol', 'Rocuronium', 'Fentanyl']}
        check(all(not x[0] and 'UNASSESSED' in x[1] for x in unsupported.values()),
              f'{label}: unsupported drug assessed')
    return {
        'label': label, 'fictional': True,
        'narrative_metadata': {'sex': sex, 'height_cm': height_cm, 'sex_and_height_used_by_model': False},
        'model_inputs': {'age': age, 'weight_kg': weight_kg, 'asa_class': 3 if conditions else 2, 'egfr': egfr,
                         'allergies': [], 'comorbidities': conditions},
        'lockouts': c.hard_lockouts, 'starting': starting,
        'starting_mass_per_hour': {'Dexmedetomidine_mcg': starting['Dexmedetomidine'] * weight_kg,
                                   'Ketamine_mg': starting['Ketamine'] * weight_kg,
                                   'Lidocaine_mg': starting['Lidocaine'] * weight_kg},
        'trace': trace, 'after_explicit_regeneration': regenerated, 'unsupported_drugs': unsupported,
    }


def boundary_example():
    with contextlib.redirect_stdout(io.StringIO()):
        c = SmartNOAController(Patient(65, 70, 2, 30, [], []), CONFIG)
        rates = c.generate_starting_rates()
        with patch('smart_noa_controller.random.randint', side_effect=[48, 60]), \
                patch('smart_noa_controller.time.sleep'):
            c.monitor_and_control(1)
    check(rates['Dexmedetomidine'] == 0.5, 'boundary: unexpected dexmedetomidine starting rate')
    check('Ketorolac' not in c.hard_lockouts, 'boundary: eGFR 30 must not lock ketorolac')
    check(c.status == 'GREEN' and not c.hold_latched, 'boundary: exact thresholds must not latch')
    return {
        'age': 65, 'egfr': 30, 'hr': 48, 'map_mmHg': 60, 'starting': rates, 'status': c.status,
        'explanation': 'Strict comparisons: exact boundary values do not trigger these configured rules; '
                       'clinical acceptability remains unassessed.',
    }


# Scripted audit-log examples (fictional): each op is replayed by the web simulator's port of the
# controller (simulator/tests/parity.test.mjs), which must reproduce every event code and message.
AUDIT_SCRIPTS = [
    ('acknowledged_release', [
        {'op': 'vitals', 'readings': [[80, 80], [80, 55], [80, 80]]},
        {'op': 'resume', 'by': 'clinician'},
        {'op': 'acknowledge', 'by': 'clinician', 'note': 'MAP cause reviewed'},
        {'op': 'vitals', 'readings': [[80, 80]]},
        {'op': 'resume', 'by': 'clinician'},
        {'op': 'vitals', 'readings': [[80, 80], [80, 80]]}]),
    ('stale_and_consumed_acknowledgment', [
        {'op': 'vitals', 'readings': [[80, 80], [46, 80]]},
        {'op': 'acknowledge', 'by': 'clinician', 'note': ''},
        {'op': 'vitals', 'readings': [[80, 55]]},
        {'op': 'resume', 'by': 'clinician'},
        {'op': 'acknowledge', 'by': 'clinician', 'note': ''},
        {'op': 'resume', 'by': 'clinician'},
        {'op': 'vitals', 'readings': [[80, 80], [46, 80]]},
        {'op': 'resume', 'by': 'clinician'}]),
    ('unusable_readings', [
        {'op': 'vitals', 'readings': [[80, 80], [None, 80], [80, 80], [350, 80], [80, 80], [80, 81], [30, 80],
                                      [80, 80], [80, 40.5], [True, 80], ['80', 80], [80]]}]),
    ('rate_faults', [
        {'op': 'vitals', 'readings': [[80, 80]]},
        {'op': 'set_rate', 'drug': 'Ketamine', 'rate': 999},
        {'op': 'vitals', 'readings': [[80, 80]]},
        {'op': 'set_rate', 'drug': 'Lidocaine', 'rate': -1},
        {'op': 'vitals', 'readings': [[80, 80], [80, 80]]}]),
    ('suspension', [
        {'op': 'vitals', 'readings': [[80, 80]]},
        {'op': 'suspend', 'seconds': 5, 'by': 'clinician', 'reason': ' <b>"planned"</b> vagal test — é ✓ '},
        {'op': 'suspend', 'seconds': 5, 'by': 'clinician', 'reason': 'second'},
        {'op': 'vitals', 'readings': [[46, 80], [80, 55], [80, 80], [None, 80], [80, 80], [80, 80], [46, 80]]},
        {'op': 'acknowledge', 'by': 'clinician', 'note': ''},
        {'op': 'suspend', 'seconds': 3, 'by': 'clinician', 'reason': 'during a hold'},
        {'op': 'vitals', 'readings': [[80, 80]]},
        {'op': 'end_suspension', 'by': 'clinician'},
        {'op': 'end_suspension', 'by': 'clinician'},
        {'op': 'suspend', 'seconds': 0, 'by': 'clinician', 'reason': 'too short'},
        {'op': 'suspend', 'seconds': 301, 'by': 'clinician', 'reason': 'too long'},
        {'op': 'suspend', 'seconds': 60, 'by': 'clinician', 'reason': '   '}]),
    ('long_hold_advisory', [
        {'op': 'vitals', 'readings': [[46, 80]]},
        {'op': 'steady', 'reading': [80, 80], 'seconds': 1201}]),
]


def audit_example(label, ops):
    refusals = []
    with contextlib.redirect_stdout(io.StringIO()):
        c = SmartNOAController(Patient(40, 70, 2, 90, [], []), CONFIG)
        c.generate_starting_rates()
        for op in ops:
            try:
                if op['op'] in ('vitals', 'steady'):
                    readings = op['readings'] if op['op'] == 'vitals' else [op['reading']] * op['seconds']
                    c.monitor_and_control(len(readings), vitals=readings, sleep_sec=0)
                elif op['op'] == 'acknowledge':
                    c.acknowledge_hold(op['by'], op['note'])
                elif op['op'] == 'resume':
                    c.resume_hold(op['by'])
                elif op['op'] == 'suspend':
                    c.suspend_interlocks(op['seconds'], op['by'], op['reason'])
                elif op['op'] == 'end_suspension':
                    c.end_suspension(op['by'])
                elif op['op'] == 'set_rate':
                    c.infusions[op['drug']] = op['rate']
            except ValueError as error:
                refusals.append({'t_sec': c.clock_sec, 'op': op['op'], 'message': str(error)})
    check(all(e['code'] != 'hold_released' or e['t_sec'] >= 0 for e in c.events), f'{label}: bad event')
    return {'label': label, 'fictional': True, 'ops': ops, 'refusals': refusals, 'events': c.events,
            'final': {'status': c.status, 'hold_latched': c.hold_latched, 'infusions': dict(c.infusions),
                      'suspended': c.suspended, 'hold_reasons': c.hold_reasons}}


if __name__ == '__main__':
    results = [scenario('M1', 'male', 180, 40, 80, 90, []),
               scenario('F1', 'female', 165, 40, 60, 90, []),
               scenario('M2', 'male', 180, 78, 80, 24, ['Heart Block']),
               scenario('F2', 'female', 165, 78, 60, 24, ['Heart Block'])]
    for a, b in [(results[0], results[1]), (results[2], results[3])]:
        check(all(abs(x['Cp_ng_mL'] - y['Cp_ng_mL']) < 1e-12 and abs(x['Ce_ng_mL'] - y['Ce_ng_mL']) < 1e-12
                  for x, y in zip(a['trace'], b['trace'], strict=True)),
              'weight must not change the per-kg concentration trace')
    print(json.dumps({
        'scope': 'Educational software trace; no real administration',
        'rate_units': {'Dexmedetomidine': 'mcg/kg/hour', 'Ketamine': 'mg/kg/hour', 'Lidocaine': 'mg/kg/hour'},
        'examples': results, 'exact_boundary': boundary_example(),
        'audit_examples': [audit_example(label, ops) for label, ops in AUDIT_SCRIPTS],
    }, indent=2))
