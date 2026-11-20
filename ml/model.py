"""
ml/model.py — Model constants, pipeline builders, and persistence utilities.

NOTE: Models are trained on SYNTHETIC data (49 rows). Do not use for
production safety decisions without real-world validation.
"""

import os
import joblib
from pathlib import Path

from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import RandomForestClassifier

try:
    from xgboost import XGBClassifier
    XGB_AVAILABLE = True
except ImportError:
    XGB_AVAILABLE = False

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

RF_MODEL_PATH = "models/rf_risk_model.joblib"
XGB_MODEL_PATH = "models/xgb_risk_model.joblib"

LABEL_MAP = {0: "Low", 1: "Medium", 2: "High"}
RANDOM_SEED = 42


# ---------------------------------------------------------------------------
# Pipeline builders
# ---------------------------------------------------------------------------

def make_rf_pipeline() -> Pipeline:
    """Return a StandardScaler + RandomForest pipeline for multi-class risk."""
    clf = RandomForestClassifier(
        n_estimators=200,
        max_depth=8,
        min_samples_leaf=2,
        random_state=RANDOM_SEED,
        class_weight="balanced",
        n_jobs=-1,
    )
    return Pipeline([("scaler", StandardScaler()), ("clf", clf)])


def make_xgb_pipeline(scale_pos_weight: float = 1.0) -> Pipeline:
    """Return a StandardScaler + XGBClassifier pipeline for multi-class risk.

    Args:
        scale_pos_weight: Heuristic weight to handle class imbalance.
                          For multi-class XGBoost this is a rough proxy;
                          XGBoost internally manages per-class weights when
                          using softmax/softprob objectives.
    """
    if not XGB_AVAILABLE:
        raise ImportError("xgboost is not installed. Run: pip install xgboost")

    clf = XGBClassifier(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=RANDOM_SEED,
        eval_metric="mlogloss",
        tree_method="hist",
        objective="multi:softprob",
        num_class=3,
        # scale_pos_weight has limited effect in multiclass; kept for API compat
        verbosity=0,
    )
    return Pipeline([("scaler", StandardScaler()), ("clf", clf)])


# ---------------------------------------------------------------------------
# Persistence helpers
# ---------------------------------------------------------------------------

def load_model(path: str):
    """Load a joblib model. Returns None (without raising) if file is missing."""
    p = Path(path)
    if not p.exists():
        return None
    return joblib.load(p)


def save_model(model, path: str) -> None:
    """Persist *model* to *path*, creating parent directories as needed."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, p)
    print(f"[model] Saved → {p.resolve()}")
