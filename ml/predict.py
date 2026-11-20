"""
ml/predict.py — RiskPredictor: single-sample inference wrapper.

Required input keys: FEATURE_COLS from ml.features.
Loads the XGBoost model by default; falls back gracefully if model file missing.

NOTE: Models trained on SYNTHETIC data. Not for production safety decisions.
"""

import sys
import os
from pathlib import Path
from typing import Dict, Any, Optional

# Allow running from any cwd
_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT))

from ml.features import FEATURE_COLS
from ml.model import XGB_MODEL_PATH, LABEL_MAP, load_model


class RiskPredictor:
    """Wrapper for single-sample road risk prediction.

    Args:
        model_path: Path to a joblib-serialised sklearn Pipeline.
                    Defaults to XGB_MODEL_PATH.
    """

    def __init__(self, model_path: str = XGB_MODEL_PATH):
        self.model_path = model_path
        self._model = load_model(model_path)
        self.model_available: bool = self._model is not None
        self.available: bool = self.model_available
        if not self.model_available:
            print(
                f"[RiskPredictor] WARNING: model not found at '{model_path}'. "
                "Call ml/train.py first. Predictions will return None."
            )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def validate_input(self, sensor_dict: Dict[str, Any]) -> None:
        """Raise ValueError if any required key is missing or non-numeric."""
        missing = [k for k in FEATURE_COLS if k not in sensor_dict]
        if missing:
            raise ValueError(
                f"Missing required sensor keys: {missing}. "
                f"Required: {FEATURE_COLS}"
            )
        non_numeric = []
        for k in FEATURE_COLS:
            try:
                float(sensor_dict[k])
            except (TypeError, ValueError):
                non_numeric.append(k)
        if non_numeric:
            raise ValueError(
                f"Non-numeric values for keys: {non_numeric}."
            )

    def predict(self, sensor_dict: Dict[str, Any]) -> Dict[str, Any]:
        """Return risk prediction for a single sensor observation.

        Returns:
            {
                "predicted_risk" : str  | None,   # "Low" / "Medium" / "High"
                "risk_class"     : int  | None,   # 0 / 1 / 2
                "confidence"     : float| None,   # max class probability
                "probabilities"  : {
                    "low"   : float | None,
                    "medium": float | None,
                    "high"  : float | None,
                },
                "model_available": bool,
            }
        """
        if not self.model_available:
            return {
                "predicted_risk": None,
                "risk_class": None,
                "confidence": None,
                "probabilities": {"low": None, "medium": None, "high": None},
                "model_available": False,
            }

        # Will raise ValueError on bad input
        self.validate_input(sensor_dict)

        import pandas as pd
        row = pd.DataFrame([[float(sensor_dict[k]) for k in FEATURE_COLS]], columns=FEATURE_COLS)

        risk_class = int(self._model.predict(row)[0])
        proba = self._model.predict_proba(row)[0]  # shape (3,)

        return {
            "predicted_risk": LABEL_MAP[risk_class],
            "risk_class": risk_class,
            "confidence": float(proba[risk_class]),
            "probabilities": {
                "low":    float(proba[0]),
                "medium": float(proba[1]),
                "high":   float(proba[2]),
            },
            "model_available": True,
        }
