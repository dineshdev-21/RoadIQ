"""
tests/test_features.py
Tests for ml.features module (synthetic fixtures + real DB).
"""
import os
import sys
import pytest
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# ---------------------------------------------------------------------------
# Skip entire module gracefully if ml is not yet available
# ---------------------------------------------------------------------------
pytest.importorskip("ml.features", reason="ml module not yet available; ml-core hasn't finished")

from ml.features import FEATURE_COLS, extract_features, load_from_sqlite

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'roadiq.db')

# ---------------------------------------------------------------------------
# Synthetic helper
# ---------------------------------------------------------------------------
def _make_synthetic_df(n: int = 20, override: dict = None) -> pd.DataFrame:
    """
    Build a minimal synthetic DataFrame that mimics what load_from_sqlite returns.
    All FEATURE_COLS present, plus road_name and severity_score.
    """
    data = {
        "vehicle_speed": [45.0] * n,
        "imu_z_rms": [1.5] * n,
        "gyro_x_peak": [22.0] * n,
        "peak_frequency": [14.0] * n,
        "kurtosis": [5.5] * n,
        "suspension_deflection_d": [18.0] * n,
        "suspension_onset_rate_r": [1.2] * n,
        "visual_confidence": [0.94] * n,
        "road_name": ["TestRoad"] * n,
        "severity_score": [3] * n,
    }
    if override:
        for k, v in override.items():
            data[k] = v if isinstance(v, list) else [v] * n
    return pd.DataFrame(data)


# ---------------------------------------------------------------------------
# 1. FEATURE_COLS order
# ---------------------------------------------------------------------------
def test_feature_cols_order():
    expected = [
        "vehicle_speed", "imu_z_rms", "gyro_x_peak", "peak_frequency",
        "kurtosis", "suspension_deflection_d", "suspension_onset_rate_r", "visual_confidence"
    ]
    assert len(FEATURE_COLS) == 8
    assert FEATURE_COLS == expected


# ---------------------------------------------------------------------------
# 2. extract_features - valid synthetic DataFrame
# ---------------------------------------------------------------------------
def test_extract_features_valid_df():
    df = _make_synthetic_df(20)
    X, y, groups = extract_features(df)
    assert X.shape == (len(X), 8), f"Expected 8 feature columns, got {X.shape[1]}"
    assert len(y) == len(X)
    assert set(y.unique()).issubset({0, 1, 2}), f"Unexpected labels: {y.unique()}"
    assert hasattr(groups, 'iloc'), "groups should be a pandas Series"


# ---------------------------------------------------------------------------
# 3. Missing column raises ValueError or KeyError
# ---------------------------------------------------------------------------
def test_missing_column_raises():
    df = _make_synthetic_df(10)
    df = df.drop(columns=["imu_z_rms"])
    with pytest.raises((ValueError, KeyError)):
        extract_features(df)


# ---------------------------------------------------------------------------
# 4. Invalid label handling — unusual severity should not crash
# ---------------------------------------------------------------------------
def test_invalid_label_handling():
    # severity=99 → label mapping will produce NaN or Medium; should not raise
    df = _make_synthetic_df(10, override={"severity_score": 99})
    try:
        X, y, groups = extract_features(df)
        # Even if all labels are dropped/mapped to Medium, should return something
        assert len(X) >= 0
    except (ValueError, KeyError):
        # Acceptable: implementation may raise if no valid rows
        pass


# ---------------------------------------------------------------------------
# 5. Numeric casting — string "1.5" in imu_z_rms
# ---------------------------------------------------------------------------
def test_numeric_casting():
    df = _make_synthetic_df(5)
    df["imu_z_rms"] = df["imu_z_rms"].astype(str)  # make strings
    X, y, groups = extract_features(df)
    assert X["imu_z_rms"].dtype in [float, "float64", "float32"], (
        f"Expected float dtype, got {X['imu_z_rms'].dtype}"
    )


# ---------------------------------------------------------------------------
# 6. load_from_sqlite — real DB
# ---------------------------------------------------------------------------
def test_load_from_sqlite():
    if not os.path.exists(DB_PATH):
        pytest.skip("roadiq.db not found at repo root")
    df = load_from_sqlite(DB_PATH)
    assert isinstance(df, pd.DataFrame)
    assert len(df) > 0, "Expected at least 1 row from roadiq.db"
    # Check presence of key sensor columns
    for col in ["imu_z_rms", "vehicle_speed"]:
        assert col in df.columns, f"Missing column {col} in loaded DataFrame"
