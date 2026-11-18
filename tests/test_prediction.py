"""
tests/test_prediction.py
Tests for ml.predict.RiskPredictor.
"""
import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

pytest.importorskip("ml.predict", reason="ml module not yet available; ml-core hasn't finished")

from ml.predict import RiskPredictor

REPO_ROOT = os.path.join(os.path.dirname(__file__), '..')
MODEL_PATH = os.path.join(REPO_ROOT, "models", "xgb_risk_model.joblib")
MODEL_EXISTS = os.path.exists(MODEL_PATH)

SAMPLE_SENSOR = {
    "vehicle_speed": 45.0,
    "imu_z_rms": 1.5,
    "gyro_x_peak": 22.0,
    "peak_frequency": 14.0,
    "kurtosis": 5.5,
    "suspension_deflection_d": 18.0,
    "suspension_onset_rate_r": 1.2,
    "visual_confidence": 0.94,
}


# ---------------------------------------------------------------------------
# 1. No model → available=False, predict returns model_available=False
# ---------------------------------------------------------------------------
def test_predictor_no_model():
    predictor = RiskPredictor(model_path="/nonexistent/path/model.joblib")
    is_available = getattr(predictor, "available", getattr(predictor, "model_available", False))
    assert is_available is False
    result = predictor.predict(SAMPLE_SENSOR)
    assert result.get("model_available") is False


# ---------------------------------------------------------------------------
# 2. Valid input structure (skip if model not trained yet)
# ---------------------------------------------------------------------------
@pytest.mark.skipif(not MODEL_EXISTS, reason="XGB model not trained yet")
def test_predictor_valid_input_structure():
    predictor = RiskPredictor(model_path=MODEL_PATH)
    is_available = getattr(predictor, "available", getattr(predictor, "model_available", False))
    assert is_available is True
    result = predictor.predict(SAMPLE_SENSOR)
    for key in ("predicted_risk", "risk_class", "confidence", "probabilities", "model_available"):
        assert key in result, f"Missing key '{key}' in predict result"
    assert result["model_available"] is True


# ---------------------------------------------------------------------------
# 3. validate_input — missing key → ValueError
# ---------------------------------------------------------------------------
def test_validate_input_missing_key():
    predictor = RiskPredictor(model_path="/nonexistent/path/model.joblib")
    bad = dict(SAMPLE_SENSOR)
    del bad["imu_z_rms"]
    with pytest.raises((ValueError, KeyError)):
        predictor.validate_input(bad)


# ---------------------------------------------------------------------------
# 4. validate_input — non-numeric value → ValueError
# ---------------------------------------------------------------------------
def test_validate_input_non_numeric():
    predictor = RiskPredictor(model_path="/nonexistent/path/model.joblib")
    bad = dict(SAMPLE_SENSOR)
    bad["imu_z_rms"] = "bad"
    with pytest.raises(ValueError):
        predictor.validate_input(bad)


# ---------------------------------------------------------------------------
# 5. Probabilities sum to ~1.0
# ---------------------------------------------------------------------------
@pytest.mark.skipif(not MODEL_EXISTS, reason="XGB model not trained yet")
def test_probabilities_sum_to_one():
    predictor = RiskPredictor(model_path=MODEL_PATH)
    result = predictor.predict(SAMPLE_SENSOR)
    probs = result["probabilities"]
    total = sum(probs.values())
    assert abs(total - 1.0) <= 0.01, f"Probabilities sum to {total}, expected ~1.0"


# ---------------------------------------------------------------------------
# 6. confidence equals max of probabilities
# ---------------------------------------------------------------------------
@pytest.mark.skipif(not MODEL_EXISTS, reason="XGB model not trained yet")
def test_confidence_matches_max_prob():
    predictor = RiskPredictor(model_path=MODEL_PATH)
    result = predictor.predict(SAMPLE_SENSOR)
    max_prob = max(result["probabilities"].values())
    assert abs(result["confidence"] - max_prob) <= 1e-6, (
        f"confidence={result['confidence']} does not match max prob={max_prob}"
    )
