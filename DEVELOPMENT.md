# Smart NOA Controller - Development Guide

This document provides detailed instructions for developers and researchers extending Smart NOA.

## Quick Start for Developers

```bash
# Clone repository
git clone https://github.com/collingeorge/Smart-NOA-Controller.git
cd Smart-NOA-Controller

# Create virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run tests to verify installation
python -m pytest test_smart_noa_controller.py -v
```

## Project Structure

```
Smart-NOA-Controller/
├── smart_noa_controller.py    # Main controller implementation
├── config.yaml                # Clinical configuration parameters
├── test_smart_noa_controller.py  # Unit tests
├── requirements.txt           # Python dependencies
├── README.md                  # User documentation
├── DEVELOPMENT.md             # This file
└── LICENSE                    # MIT License
```

## Configuration System

All clinical parameters are centralized in `config.yaml`:

### Hemodynamic Thresholds
```yaml
hemodynamic_thresholds:
  hr_critical_low: 48
  map_critical_low: 60
  rr_critical_low: 8
  sbp_critical_high: 180
```

### Drug Dosing Protocols
```yaml
drug_dosing:
  dexmedetomidine:
    standard_dose: 0.5
    geriatric_dose: 0.25
    geriatric_age_threshold: 65
```

### Pharmacokinetic Parameters
```yaml
pharmacokinetics:
  dexmedetomidine:
    central_volume_L_per_kg: 0.8
    elimination_rate_constant_k10: 0.04
    effect_site_transfer_k1e: 0.1
    ce_intervention_threshold: 0.1
```

### Contraindication Criteria
```yaml
contraindications:
  dexmedetomidine:
    cardiac_conditions:
      - "Heart Block"
      - "AV Block"
      - "Severe Bradycardia"
```

## Type Annotations

The codebase uses Python 3.8+ type hints for clarity and IDE support:

```python
def check_contraindication(self, drug: str) -> Tuple[bool, str]:
    """
    Verifies if a specific drug is allowed by the safety logic.
    
    Args:
        drug: Drug name to check
        
    Returns:
        Tuple of (is_allowed, reason_message)
    """
```

Run type checking with mypy:
```bash
mypy smart_noa_controller.py --strict
```

## Testing

### Running Tests

```bash
# Run all tests with verbose output
python -m pytest test_smart_noa_controller.py -v

# Run specific test class
python -m pytest test_smart_noa_controller.py::TestContraindications -v

# Run with coverage report
python -m pytest test_smart_noa_controller.py --cov=smart_noa_controller --cov-report=html

# Run tests and show which lines are not covered
python -m pytest test_smart_noa_controller.py --cov=smart_noa_controller --cov-report=term-missing
```

### Test Coverage

Current test suite covers:
- ✅ Hard contraindication lockouts (heart block, renal failure, allergies)
- ✅ Age-adjusted dosing calculations
- ✅ Pharmacokinetic model accuracy
- ✅ Protocol generation logic
- ✅ Unit conversion functions

### Adding New Tests

Follow the existing test structure:

```python
class TestNewFeature(unittest.TestCase):
    """Test description"""
    
    def test_specific_behavior(self):
        """Test that specific behavior works correctly"""
        patient = Patient(
            age=50, weight_kg=70, asa_class=2, 
            egfr=90, allergies=[], comorbidities=[]
        )
        
        controller = SmartNOAController(patient)
        
        # Perform test
        result = controller.some_method()
        
        # Assert expected outcome
        self.assertEqual(result, expected_value)
```

## Code Quality

### Formatting

```bash
# Format code with Black
black smart_noa_controller.py test_smart_noa_controller.py

# Sort imports with isort
isort smart_noa_controller.py test_smart_noa_controller.py
```

### Linting

```bash
# Run pylint
pylint smart_noa_controller.py

# Run flake8
flake8 smart_noa_controller.py --max-line-length=100
```

### Documentation

All classes and methods include docstrings following Google style:

```python
def method_name(self, param1: int, param2: str) -> bool:
    """
    Brief description of what the method does.
    
    Args:
        param1: Description of first parameter
        param2: Description of second parameter
        
    Returns:
        Description of return value
        
    Raises:
        ValueError: When parameter is invalid
    """
```

## Extending the Controller

### Adding a New Drug

1. **Update `config.yaml`**:
```yaml
drug_dosing:
  new_drug_name:
    standard_dose: 1.0
    loading_dose: 2.0
```

2. **Add contraindication criteria** (if applicable):
```yaml
contraindications:
  new_drug_name:
    renal_threshold: 45
    cardiac_conditions:
      - "Specific Condition"
```

3. **Update `_calculate_initial_lockouts()`**:
```python
# Check new drug contraindications
if self.patient.egfr < new_threshold:
    locks.append("NewDrugName")
```

4. **Add to `generate_starting_rates()`**:
```python
new_drug_config = self.config.get('drug_dosing', 'new_drug_name')
rates["NewDrugName"] = new_drug_config['standard_dose']
```

5. **Write tests**:
```python
def test_new_drug_contraindication(self):
    """Test new drug contraindication logic"""
    # Implementation
```

### Adding a New Safety Interlock

1. **Define threshold in `config.yaml`**:
```yaml
hemodynamic_thresholds:
  new_parameter_threshold: 100
```

2. **Implement in `monitor_and_control()`**:
```python
threshold = self.config.get('hemodynamic_thresholds', 'new_parameter_threshold')

if new_parameter > threshold:
    # Safety intervention
    self.infusions["DrugName"] = 0.0
    self.status = "RED"
    print(f"INTERVENTION: {new_parameter} exceeded threshold")
```

3. **Add unit tests**:
```python
def test_new_interlock_triggers(self):
    """Test new safety interlock activates correctly"""
    # Implementation
```

### Adding Pharmacokinetic Models for Other Drugs

1. **Define PK parameters in `config.yaml`**:
```yaml
pharmacokinetics:
  propofol:
    central_volume_L_per_kg: 0.2
    elimination_rate_constant_k10: 0.12
    effect_site_transfer_k1e: 0.45
```

2. **Initialize PK model in `__init__()`**:
```python
self.propofol_pk = self._initialize_pk_model_for('propofol')
```

3. **Update model during monitoring**:
```python
propofol_rate = self._rate_to_mcg_per_min("Propofol")
self.propofol_pk.update_concentration(propofol_rate, time_step_min)
```

## Clinical Validation Workflow

### Retrospective Validation

1. **Prepare de-identified patient data** in CSV format:
```csv
age,weight_kg,egfr,comorbidities,hr_at_event,map_at_event,adverse_event
78,72,24,"Heart Block",44,58,true
```

2. **Run controller on historical cases**:
```python
for case in historical_cases:
    patient = Patient(**case)
    controller = SmartNOAController(patient)
    would_have_prevented = controller.check_contraindication(case.drug_given)
```

3. **Calculate sensitivity and specificity**:
```python
true_positives = sum(prevented_actual_adverse_events)
false_positives = sum(prevented_safe_administrations)
sensitivity = true_positives / total_adverse_events
specificity = true_negatives / total_safe_cases
```

### Prospective Simulation

1. **Generate realistic patient cohorts**
2. **Run Monte Carlo simulations** with varied vital sign trajectories
3. **Measure intervention rates and false-positive rates**
4. **Compare to published NOA adverse event data**

## Contributing

### Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-safety-feature`)
3. Make changes with appropriate tests
4. Ensure all tests pass (`pytest`)
5. Update documentation
6. Submit pull request with clear description

### Code Review Checklist

- [ ] All new code has type hints
- [ ] All new methods have docstrings
- [ ] Unit tests added for new features
- [ ] All tests pass
- [ ] Code formatted with Black
- [ ] Configuration changes documented
- [ ] Clinical rationale provided with citations

## Performance Considerations

### Computational Requirements

- **Update frequency**: 1 Hz (one iteration per second)
- **Memory usage**: < 50 MB
- **CPU usage**: < 5% on modern hardware
- **Latency**: < 10 ms per control loop iteration

### Optimization Tips

For real-time clinical deployment:

1. **Pre-compute lookup tables** for common patient profiles
2. **Cache configuration values** rather than re-parsing YAML
3. **Use NumPy** for PK model calculations if speed critical
4. **Profile with cProfile** to identify bottlenecks:
```bash
python -m cProfile -o profile.stats smart_noa_controller.py
python -m pstats profile.stats
```

## Integration with Medical Devices

### HL7 FHIR Integration (Future)

```python
from fhirclient import client

# Connect to hospital FHIR server
settings = {
    'app_id': 'smart_noa',
    'api_base': 'https://hospital.example.com/fhir'
}

# Fetch patient data
patient_resource = Patient.read(patient_id, smart.server)
```

### Infusion Pump Control (Future)

Interface requirements:
- IEC 60601-1-8 compliance for medical device communication
- Bidirectional control with safety interlocks
- Real-time status monitoring
- Mandatory hardware kill-switch

## Regulatory Considerations

### FDA Software as Medical Device (SaMD)

Smart NOA is intended as a moderate-risk SaMD requiring:
- 510(k) premarket notification
- Design controls (ISO 13485)
- Risk management (ISO 14971)
- Clinical validation studies

### Documentation Requirements

Maintain:
- Design specifications
- Hazard analysis
- Verification and validation protocols
- Traceability matrices
- Change control records

## References

Clinical guidelines and parameters are derived from:

1. Beloeil et al. (2021) - Opioid-free anaesthesia guidelines
2. Weerink et al. (2017) - Dexmedetomidine pharmacokinetics
3. Frauenknecht et al. (2019) - Multimodal analgesia meta-analysis
4. FDA (2019) - Clinical Decision Support Software guidance

## Support

- **Issues**: https://github.com/collingeorge/Smart-NOA-Controller/issues
- **Email**: george.colling@uw.edu
- **Citation**: See README.md for preprint details

---

**Last Updated**: November 2025  
**Maintainer**: George Colling
