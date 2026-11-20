"""
ml/features.py — Data loading, feature extraction, label derivation, and validation.

FEATURE_COLS (order is canonical and must not be changed):
    vehicle_speed, imu_z_rms, gyro_x_peak, peak_frequency,
    kurtosis, suspension_deflection_d, suspension_onset_rate_r, visual_confidence

TARGET: risk_label (int)
    0 = Low   : severity_score <= 2  AND imu_z_rms < 1.0
    2 = High  : severity_score >= 4  AND imu_z_rms >= 1.2
    1 = Medium: everything else

GROUPING: road_name used as road_segment_id for GroupShuffleSplit (not a feature).

NOTE: Data is SYNTHETIC (49 rows). Not validated on real-world deployments.
"""

import json
import sqlite3
import warnings
from pathlib import Path
from typing import Tuple

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

FEATURE_COLS = [
    "vehicle_speed",
    "imu_z_rms",
    "gyro_x_peak",
    "peak_frequency",
    "kurtosis",
    "suspension_deflection_d",
    "suspension_onset_rate_r",
    "visual_confidence",
]

# Soft range bounds for validation warnings (not used to drop rows)
_RANGE_BOUNDS = {
    "vehicle_speed":          (0.0, 200.0),   # km/h
    "imu_z_rms":              (0.0, 20.0),    # g-force RMS
    "gyro_x_peak":            (0.0, 360.0),   # deg/s
    "peak_frequency":         (0.0, 100.0),   # Hz
    "kurtosis":               (1.0, 50.0),    # dimensionless
    "suspension_deflection_d":(0.0, 100.0),   # mm
    "suspension_onset_rate_r":(0.0, 50.0),    # mm/s
    "visual_confidence":      (0.0, 1.0),     # probability
}


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------

def load_from_sqlite(db_path: str) -> pd.DataFrame:
    """Read the *alerts* table from *db_path*, parse sensor_snapshot_json,
    and return a flat DataFrame with all columns needed for feature extraction.

    The sensor_snapshot_json blob is expected to contain at minimum:
        imu_z_rms, gyro_x_peak, peak_frequency, kurtosis,
        suspension_deflection_d, suspension_onset_rate_r, visual_confidence
    """
    conn = sqlite3.connect(db_path)
    try:
        df_raw = pd.read_sql("SELECT * FROM alerts", conn)
    finally:
        conn.close()

    if df_raw.empty:
        raise ValueError(f"alerts table in {db_path!r} is empty.")

    # Parse sensor JSON blob
    sensor_rows = []
    for idx, blob in enumerate(df_raw["sensor_snapshot_json"]):
        if pd.isna(blob) or blob == "":
            sensor_rows.append({})
        else:
            try:
                sensor_rows.append(json.loads(blob) if isinstance(blob, str) else blob)
            except (json.JSONDecodeError, TypeError):
                warnings.warn(f"Row {idx}: could not parse sensor_snapshot_json — treating as empty.")
                sensor_rows.append({})

    sensor_df = pd.DataFrame(sensor_rows)
    # Drop duplicate columns (vehicle_speed already in alerts table)
    sensor_df = sensor_df.drop(columns=["vehicle_speed"], errors="ignore")

    df = pd.concat([df_raw.reset_index(drop=True), sensor_df.reset_index(drop=True)], axis=1)
    return df


def load_from_csv(csv_path: str) -> pd.DataFrame:
    """Read a CSV that already has flat columns (no JSON blobs required).

    Expects at minimum: FEATURE_COLS + ['severity_score', 'road_name'].
    """
    df = pd.read_csv(csv_path)
    if df.empty:
        raise ValueError(f"CSV at {csv_path!r} is empty.")
    return df


# ---------------------------------------------------------------------------
# Feature extraction
# ---------------------------------------------------------------------------

def _derive_risk_label(df: pd.DataFrame) -> pd.Series:
    """Multi-signal label derivation (see module docstring for thresholds).

    Uses severity_score (computed by the existing severity formula) together
    with imu_z_rms as a secondary signal so labels are not a pure 1:1 mapping
    of the formula output — this reduces target leakage.
    """
    sev = pd.to_numeric(df["severity_score"], errors="coerce")
    imu = pd.to_numeric(df["imu_z_rms"], errors="coerce")

    labels = np.where(
        (sev <= 2) & (imu < 1.0),   1,          # provisional Medium
        np.where(
            (sev >= 4) & (imu >= 1.2), 2, 1     # High or Medium
        )
    )
    # Low condition
    low_mask = (sev <= 2) & (imu < 1.0)
    labels = np.where(low_mask, 0, labels)

    return pd.Series(labels, index=df.index, name="risk_label", dtype=int)


def validate_feature_ranges(df: pd.DataFrame) -> None:
    """Print warnings for sensor readings outside expected physical bounds.
    Rows are NEVER dropped; only a warning is printed.
    """
    for col, (lo, hi) in _RANGE_BOUNDS.items():
        if col not in df.columns:
            continue
        series = pd.to_numeric(df[col], errors="coerce")
        out = series[(series < lo) | (series > hi)].dropna()
        if not out.empty:
            print(
                f"  [RANGE WARNING] '{col}': {len(out)} value(s) outside [{lo}, {hi}] "
                f"— indices {out.index.tolist()}"
            )


def extract_features(
    df: pd.DataFrame,
) -> Tuple[pd.DataFrame, pd.Series, pd.Series]:
    """Validate, impute, and extract features from a flat DataFrame.

    Returns:
        X_df      : DataFrame with FEATURE_COLS columns (float64)
        y_series  : risk_label (int, 0/1/2)
        groups    : road_name strings for GroupShuffleSplit
    """
    df = df.copy()

    # ---- Cast numeric columns ----
    for col in FEATURE_COLS + ["severity_score"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # ---- Median imputation ----
    for col in FEATURE_COLS:
        if col not in df.columns:
            raise ValueError(
                f"Required feature column '{col}' is missing from the DataFrame. "
                f"Present columns: {df.columns.tolist()}"
            )
        n_missing = df[col].isna().sum()
        if n_missing > 0:
            median_val = df[col].median()
            df[col] = df[col].fillna(median_val)
            print(f"  [IMPUTE] '{col}': filled {n_missing} NaN(s) with median={median_val:.4f}")

    # ---- Validate ranges (warnings only) ----
    print("\n[features] Range validation:")
    validate_feature_ranges(df)

    # ---- Derive risk labels ----
    if "severity_score" not in df.columns:
        raise ValueError("'severity_score' column required for label derivation but not found.")
    df["risk_label"] = _derive_risk_label(df)

    # ---- Groups ----
    if "road_name" not in df.columns:
        raise ValueError("'road_name' column required for group-aware splitting but not found.")
    groups = df["road_name"].fillna("unknown").rename("road_segment_id")

    # ---- Subset to feature columns + label ----
    X_df = df[FEATURE_COLS].astype(np.float64)
    y_series = df["risk_label"].astype(int)

    # ---- Summary ----
    total = len(df)
    valid = y_series.notna().sum()
    dist = y_series.value_counts().sort_index().to_dict()
    label_names = {0: "Low", 1: "Medium", 2: "High"}
    dist_str = ", ".join(f"{label_names.get(k, k)}={v}" for k, v in dist.items())
    print(f"\n[features] Summary:")
    print(f"  Total rows      : {total}")
    print(f"  Rows with labels: {valid}")
    print(f"  Class distribution: {dist_str}")
    print(f"  Road segments   : {groups.nunique()} unique")

    return X_df, y_series, groups
