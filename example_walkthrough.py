"""Reproduce fictional examples of existing code; not clinical dosing advice."""
import contextlib
import io
import json
from pathlib import Path
from unittest.mock import patch
from smart_noa_controller import Patient, SmartNOAController
CONFIG = str(Path(__file__).with_name('config.yaml'))

def scenario(label, sex, height_cm, age, weight_kg, egfr, conditions):
    with contextlib.redirect_stdout(io.StringIO()):
        c = SmartNOAController(Patient(age, weight_kg, 3 if conditions else 2, egfr, [], conditions), CONFIG)
        starting = c.generate_starting_rates()
        trace = []
        for hr, map_value in [(80, 80), (40, 50), (80, 80)]:
            before = dict(c.infusions)
            with patch('smart_noa_controller.random.randint', side_effect=[hr, map_value]), patch('smart_noa_controller.time.sleep'):
                c.monitor_and_control(1)
            trace.append(dict(step=len(trace)+1, hr=hr, map_mmHg=map_value,
                rates_before=before, rates_after=dict(c.infusions), status=c.status,
                hold_latched=c.hold_latched, Cp_ng_mL=c.dex_pk.Cp, Ce_ng_mL=c.dex_pk.Ce))
        regenerated = c.generate_starting_rates()
        assert [x['status'] for x in trace] == ['GREEN', 'RED', 'HOLD']
        assert trace[1]['rates_after']['Dexmedetomidine'] == 0
        assert trace[1]['rates_after']['Lidocaine'] == 0
        assert trace[1]['rates_after']['Ketamine'] == 0.2
        assert all(value == 0 for value in c.infusions.values())
        unsupported = {drug: c.check_contraindication(drug) for drug in ['Propofol', 'Rocuronium', 'Fentanyl']}
        assert all(not x[0] and 'UNASSESSED' in x[1] for x in unsupported.values())
    return dict(label=label, fictional=True,
        narrative_metadata=dict(sex=sex, height_cm=height_cm, sex_and_height_used_by_model=False),
        model_inputs=dict(age=age, weight_kg=weight_kg, asa_class=3 if conditions else 2, egfr=egfr, allergies=[], comorbidities=conditions),
        lockouts=c.hard_lockouts, starting=starting,
        starting_mass_per_hour=dict(Dexmedetomidine_mcg=starting['Dexmedetomidine']*weight_kg,
            Ketamine_mg=starting['Ketamine']*weight_kg, Lidocaine_mg=starting['Lidocaine']*weight_kg),
        trace=trace, after_explicit_regeneration=regenerated, unsupported_drugs=unsupported)

def boundary_example():
    with contextlib.redirect_stdout(io.StringIO()):
        c = SmartNOAController(Patient(65, 70, 2, 30, [], []), CONFIG)
        rates = c.generate_starting_rates()
        with patch('smart_noa_controller.random.randint', side_effect=[48, 60]), patch('smart_noa_controller.time.sleep'):
            c.monitor_and_control(1)
    assert rates['Dexmedetomidine'] == 0.5
    assert 'Ketorolac' not in c.hard_lockouts
    assert c.status == 'GREEN' and not c.hold_latched
    return dict(age=65, egfr=30, hr=48, map_mmHg=60, starting=rates, status=c.status,
        explanation='Strict comparisons: exact boundary values do not trigger these configured rules; clinical acceptability remains unassessed.')

if __name__ == '__main__':
    results = [scenario('M1', 'male', 180, 40, 80, 90, []),
        scenario('F1', 'female', 165, 40, 60, 90, []),
        scenario('M2', 'male', 180, 78, 80, 24, ['Heart Block']),
        scenario('F2', 'female', 165, 78, 60, 24, ['Heart Block'])]
    for a,b in [(results[0],results[1]),(results[2],results[3])]:
        assert all(abs(x['Cp_ng_mL']-y['Cp_ng_mL']) < 1e-12 and abs(x['Ce_ng_mL']-y['Ce_ng_mL']) < 1e-12
            for x,y in zip(a['trace'],b['trace']))
    print(json.dumps(dict(scope='Educational software trace; no real administration',
        rate_units=dict(Dexmedetomidine='mcg/kg/hour',Ketamine='mg/kg/hour',Lidocaine='mg/kg/hour'),
        examples=results,exact_boundary=boundary_example()),indent=2))
