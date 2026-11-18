"""
ml/train.py — Train RandomForest and XGBoost risk classifiers, save models.

Usage:
    python ml/train.py                      # uses roadiq.db in repo root
    python ml/train.py --db /path/to/db     # explicit DB path

⚠️  SYNTHETIC DATA WARNING — See banner printed at runtime.
"""

import sys
import os
import argparse
from pathlib import Path

# ---- ensure repo root is on sys.path ----
_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT))

import numpy as np
from sklearn.model_selection import GroupShuffleSplit, StratifiedShuffleSplit

from ml.features import load_from_sqlite, extract_features, FEATURE_COLS
from ml.model import (
    make_rf_pipeline,
    make_xgb_pipeline,
    save_model,
    RF_MODEL_PATH,
    XGB_MODEL_PATH,
    LABEL_MAP,
    RANDOM_SEED,
)

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------

SYNTHETIC_BANNER = """
╔══════════════════════════════════════════════════════════════════════════╗
║          ⚠️   SYNTHETIC DATA WARNING — RoadIQ ML Pipeline   ⚠️          ║
║                                                                          ║
║  Training data is SYNTHETIC (N=49 rows, 7 road segments).               ║
║  Metrics reflect overfitting risk on tiny datasets.                      ║
║  Do NOT use model outputs for real-world safety decisions without        ║
║  proper validation on real sensor data.                                  ║
╚══════════════════════════════════════════════════════════════════════════╝
"""


def _class_dist_str(y) -> str:
    """Pretty-print class distribution from a numpy/pandas array."""
    import pandas as pd
    s = pd.Series(y).value_counts().sort_index()
    return "  " + ", ".join(f"{LABEL_MAP.get(k, k)}={v}" for k, v in s.items())


def run_training(db_path: str) -> None:
    print(SYNTHETIC_BANNER)

    # ------------------------------------------------------------------ #
    # 1. Load data
    # ------------------------------------------------------------------ #
    print("[train] Loading data from:", db_path)
    df_raw = load_from_sqlite(db_path)

    # ------------------------------------------------------------------ #
    # 2. Extract features
    # ------------------------------------------------------------------ #
    X, y, groups = extract_features(df_raw)
    n_total = len(y)

    if n_total < 30:
        print(
            f"\n⚠️  WARNING: Only {n_total} labelled samples available. "
            "Model generalisation is extremely limited. "
            "Collect more real-world data before production use.\n"
        )

    # ------------------------------------------------------------------ #
    # 3. Train/test split
    # ------------------------------------------------------------------ #
    unique_segments = groups.nunique()
    print(f"\n[train] Unique road segments: {unique_segments}")

    if unique_segments >= 5:
        print("[train] Split strategy: GroupShuffleSplit (group-aware)")
        splitter = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=RANDOM_SEED)
        train_idx, test_idx = next(splitter.split(X, y, groups=groups))
    else:
        print(
            f"⚠️  WARNING: Only {unique_segments} road segments — fewer than 5 required "
            "for GroupShuffleSplit. Falling back to StratifiedShuffleSplit."
        )
        splitter = StratifiedShuffleSplit(n_splits=1, test_size=0.25, random_state=RANDOM_SEED)
        train_idx, test_idx = next(splitter.split(X, y))

    X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
    y_train, y_test = y.iloc[train_idx], y.iloc[test_idx]

    print(f"\n[train] Train size: {len(X_train)}, Test size: {len(X_test)}")
    print("[train] Train class distribution:")
    print(_class_dist_str(y_train))
    print("[train] Test class distribution:")
    print(_class_dist_str(y_test))

    # Check all classes are represented
    train_classes = set(y_train.unique())
    test_classes  = set(y_test.unique())
    all_classes   = set(y.unique())
    if not all_classes.issubset(train_classes):
        missing = all_classes - train_classes
        print(f"\n⚠️  WARNING: Classes {missing} not in training set — model will not predict them.")

    # ------------------------------------------------------------------ #
    # 4. Train RandomForest
    # ------------------------------------------------------------------ #
    print("\n[train] Fitting RandomForest pipeline …")
    rf_pipe = make_rf_pipeline()
    rf_pipe.fit(X_train, y_train)
    save_model(rf_pipe, RF_MODEL_PATH)

    train_acc_rf = rf_pipe.score(X_train, y_train)
    test_acc_rf  = rf_pipe.score(X_test,  y_test)
    print(f"  RF  train accuracy: {train_acc_rf:.4f}  |  test accuracy: {test_acc_rf:.4f}")

    # ------------------------------------------------------------------ #
    # 5. Train XGBoost
    # ------------------------------------------------------------------ #
    # Heuristic scale_pos_weight: ratio of majority to minority class
    class_counts = y_train.value_counts().sort_index()
    max_count = class_counts.max()
    min_count = class_counts.min()
    spw = float(max_count / max(min_count, 1))
    print(f"\n[train] Fitting XGBoost pipeline (scale_pos_weight heuristic={spw:.2f}) …")
    xgb_pipe = make_xgb_pipeline(scale_pos_weight=spw)
    xgb_pipe.fit(X_train, y_train)
    save_model(xgb_pipe, XGB_MODEL_PATH)

    train_acc_xgb = xgb_pipe.score(X_train, y_train)
    test_acc_xgb  = xgb_pipe.score(X_test,  y_test)
    print(f"  XGB train accuracy: {train_acc_xgb:.4f}  |  test accuracy: {test_acc_xgb:.4f}")

    # ------------------------------------------------------------------ #
    # 6. Summary
    # ------------------------------------------------------------------ #
    print("\n" + "=" * 60)
    print("[train] DONE — Training complete.")
    print(f"  RF  model saved to : {RF_MODEL_PATH}")
    print(f"  XGB model saved to : {XGB_MODEL_PATH}")
    print("=" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train RoadIQ risk models")
    parser.add_argument(
        "--db",
        default=str(_REPO_ROOT / "roadiq.db"),
        help="Path to roadiq.db (default: repo root/roadiq.db)",
    )
    args = parser.parse_args()
    run_training(args.db)
