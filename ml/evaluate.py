"""
ml/evaluate.py — Evaluate trained RF and XGBoost models on test split.

Produces:
  reports/confusion_matrix_rf.png
  reports/confusion_matrix_xgb.png
  reports/model_comparison.png
  reports/feature_importance_rf.png
  reports/feature_importance_xgb.png
  reports/class_distribution.png
  reports/evaluation_results.json

Usage:
    python ml/evaluate.py          # uses roadiq.db in repo root
    python ml/evaluate.py --db /path/to/db

⚠️  SYNTHETIC DATA WARNING — results do not reflect real-world performance.
"""

import sys
import os
import json
import argparse
import warnings
from pathlib import Path

# ---- ensure repo root is on sys.path ----
_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT))

import numpy as np
import matplotlib
matplotlib.use("Agg")  # headless backend
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    classification_report,
    confusion_matrix,
)
from sklearn.model_selection import GroupShuffleSplit, StratifiedShuffleSplit

from ml.features import load_from_sqlite, extract_features, FEATURE_COLS
from ml.model import (
    load_model,
    RF_MODEL_PATH,
    XGB_MODEL_PATH,
    LABEL_MAP,
    RANDOM_SEED,
)

REPORTS_DIR = Path(_REPO_ROOT / "reports")
LABEL_NAMES  = ["Low", "Medium", "High"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_test_split(X, y, groups):
    """Reproduce the same split used in train.py."""
    unique_segs = groups.nunique()
    if unique_segs >= 5:
        splitter = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=RANDOM_SEED)
        _, test_idx = next(splitter.split(X, y, groups=groups))
    else:
        splitter = StratifiedShuffleSplit(n_splits=1, test_size=0.25, random_state=RANDOM_SEED)
        _, test_idx = next(splitter.split(X, y))
    return X.iloc[test_idx], y.iloc[test_idx]


def _convert_for_json(obj):
    if isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, dict):
        return {k: _convert_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_convert_for_json(v) for v in obj]
    return obj


def _compute_metrics(model, X_test, y_test, model_name: str) -> dict:
    """Compute all required metrics for a single model."""
    y_pred = model.predict(X_test)
    labels = [int(x) for x in sorted(y_test.unique())]
    report = classification_report(
        y_test, y_pred,
        labels=labels,
        target_names=[LABEL_NAMES[l] for l in labels],
        output_dict=True,
        zero_division=0,
    )
    cm = confusion_matrix(y_test, y_pred, labels=labels).tolist()
    return _convert_for_json({
        "model":              model_name,
        "n_test":             int(len(y_test)),
        "accuracy":           float(accuracy_score(y_test, y_pred)),
        "balanced_accuracy":  float(balanced_accuracy_score(y_test, y_pred)),
        "precision_macro":    float(precision_score(y_test, y_pred, average="macro", zero_division=0)),
        "recall_macro":       float(recall_score(y_test, y_pred, average="macro", zero_division=0)),
        "f1_macro":           float(f1_score(y_test, y_pred, average="macro", zero_division=0)),
        "classification_report": report,
        "confusion_matrix":   cm,
        "labels_in_test":     labels,
    })


# ---------------------------------------------------------------------------
# Plots
# ---------------------------------------------------------------------------

def _plot_confusion_matrix(cm: list, labels: list, title: str, path: Path) -> None:
    cm_arr = np.array(cm)
    fig, ax = plt.subplots(figsize=(5, 4))
    im = ax.imshow(cm_arr, interpolation="nearest", cmap=plt.cm.Blues)
    fig.colorbar(im, ax=ax)
    ax.set(
        xticks=range(len(labels)),
        yticks=range(len(labels)),
        xticklabels=[LABEL_NAMES[l] for l in labels],
        yticklabels=[LABEL_NAMES[l] for l in labels],
        title=title,
        ylabel="True label",
        xlabel="Predicted label",
    )
    thresh = cm_arr.max() / 2.0
    for i in range(cm_arr.shape[0]):
        for j in range(cm_arr.shape[1]):
            ax.text(j, i, str(cm_arr[i, j]), ha="center", va="center",
                    color="white" if cm_arr[i, j] > thresh else "black")
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)
    print(f"  [report] Saved {path.name}")


def _plot_model_comparison(metrics_rf: dict, metrics_xgb: dict, path: Path) -> None:
    metric_keys = ["accuracy", "balanced_accuracy", "precision_macro", "recall_macro", "f1_macro"]
    metric_labels = ["Accuracy", "Bal.Acc.", "Precision\n(macro)", "Recall\n(macro)", "F1\n(macro)"]
    rf_vals  = [metrics_rf[k]  for k in metric_keys]
    xgb_vals = [metrics_xgb[k] for k in metric_keys]
    x = np.arange(len(metric_keys))
    w = 0.35
    fig, ax = plt.subplots(figsize=(8, 4))
    ax.bar(x - w/2, rf_vals,  w, label="RandomForest", color="#2196F3", alpha=0.85)
    ax.bar(x + w/2, xgb_vals, w, label="XGBoost",      color="#FF9800", alpha=0.85)
    ax.set_xticks(x)
    ax.set_xticklabels(metric_labels)
    ax.set_ylim(0, 1.05)
    ax.set_ylabel("Score")
    ax.set_title("Model Comparison — RF vs XGBoost (Synthetic Test Set)")
    ax.legend()
    ax.yaxis.set_major_formatter(mticker.FormatStrFormatter("%.2f"))
    ax.grid(axis="y", linestyle="--", alpha=0.4)
    for rect in ax.patches:
        h = rect.get_height()
        ax.text(rect.get_x() + rect.get_width() / 2, h + 0.01, f"{h:.2f}",
                ha="center", va="bottom", fontsize=8)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)
    print(f"  [report] Saved {path.name}")


def _plot_feature_importance(model, model_name: str, path: Path) -> None:
    """Extract feature importances from the classifier inside the pipeline."""
    clf = model.named_steps["clf"]
    if hasattr(clf, "feature_importances_"):
        importances = clf.feature_importances_
    else:
        print(f"  [report] {model_name}: no feature_importances_ — skipping plot.")
        return
    idx = np.argsort(importances)[::-1]
    sorted_names = [FEATURE_COLS[i] for i in idx]
    sorted_imps  = importances[idx]
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.bar(range(len(FEATURE_COLS)), sorted_imps, color="#4CAF50", alpha=0.85)
    ax.set_xticks(range(len(FEATURE_COLS)))
    ax.set_xticklabels(sorted_names, rotation=35, ha="right", fontsize=9)
    ax.set_ylabel("Feature Importance (Gini / Gain)")
    ax.set_title(f"{model_name} — Feature Importances")
    ax.grid(axis="y", linestyle="--", alpha=0.4)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)
    print(f"  [report] Saved {path.name}")


def _plot_class_distribution(y_full: "pd.Series", y_train: "pd.Series", y_test: "pd.Series", path: Path) -> None:
    import pandas as pd
    splits = {"Full": y_full, "Train": y_train, "Test": y_test}
    fig, axes = plt.subplots(1, 3, figsize=(10, 4), sharey=False)
    colors = {0: "#4CAF50", 1: "#FF9800", 2: "#F44336"}
    for ax, (split_name, y_s) in zip(axes, splits.items()):
        counts = pd.Series(y_s).value_counts().sort_index()
        bars = ax.bar(
            [LABEL_NAMES[l] for l in counts.index],
            counts.values,
            color=[colors.get(l, "#9E9E9E") for l in counts.index],
            alpha=0.85,
        )
        for bar in bars:
            ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.2,
                    str(int(bar.get_height())), ha="center", va="bottom", fontsize=9)
        ax.set_title(f"{split_name} (n={len(y_s)})")
        ax.set_ylabel("Count")
        ax.grid(axis="y", linestyle="--", alpha=0.4)
    fig.suptitle("Class Distribution Across Splits (Synthetic Data)", fontsize=11)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)
    print(f"  [report] Saved {path.name}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run_evaluation(db_path: str) -> None:
    print("\n" + "=" * 60)
    print("⚠️  SYNTHETIC DATA WARNING — evaluation on synthetic N=49 dataset.")
    print("=" * 60)

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    # ---- Load models ----
    rf_model  = load_model(RF_MODEL_PATH)
    xgb_model = load_model(XGB_MODEL_PATH)

    if rf_model is None:
        print(f"[evaluate] ERROR: RF model not found at '{RF_MODEL_PATH}'. Run ml/train.py first.")
        sys.exit(1)
    if xgb_model is None:
        print(f"[evaluate] ERROR: XGB model not found at '{XGB_MODEL_PATH}'. Run ml/train.py first.")
        sys.exit(1)

    # ---- Load & extract features ----
    print(f"\n[evaluate] Loading data from: {db_path}")
    df_raw = load_from_sqlite(db_path)
    X, y, groups = extract_features(df_raw)

    # ---- Reproduce train/test split ----
    unique_segs = groups.nunique()
    if unique_segs >= 5:
        splitter  = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=RANDOM_SEED)
        train_idx, test_idx = next(splitter.split(X, y, groups=groups))
    else:
        splitter  = StratifiedShuffleSplit(n_splits=1, test_size=0.25, random_state=RANDOM_SEED)
        train_idx, test_idx = next(splitter.split(X, y))

    X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
    y_train, y_test = y.iloc[train_idx], y.iloc[test_idx]

    n_test = len(y_test)
    if n_test < 20:
        print(
            f"\n⚠️  DISCLAIMER: Test set has only {n_test} samples. "
            "Reported metrics have very high variance and are NOT reliable "
            "for model selection or deployment decisions.\n"
        )

    # ---- Compute metrics ----
    print("[evaluate] Computing metrics …")
    metrics_rf  = _compute_metrics(rf_model,  X_test, y_test, "RandomForest")
    metrics_xgb = _compute_metrics(xgb_model, X_test, y_test, "XGBoost")

    print("\n[evaluate] RandomForest results:")
    for k in ["accuracy", "balanced_accuracy", "precision_macro", "recall_macro", "f1_macro"]:
        print(f"  {k:22s}: {metrics_rf[k]:.4f}")

    print("\n[evaluate] XGBoost results:")
    for k in ["accuracy", "balanced_accuracy", "precision_macro", "recall_macro", "f1_macro"]:
        print(f"  {k:22s}: {metrics_xgb[k]:.4f}")

    # ---- Classification reports ----
    print("\n[evaluate] RF Classification Report:")
    y_pred_rf = rf_model.predict(X_test)
    print(classification_report(
        y_test, y_pred_rf,
        labels=sorted(y_test.unique()),
        target_names=[LABEL_NAMES[l] for l in sorted(y_test.unique())],
        zero_division=0,
    ))
    print("[evaluate] XGB Classification Report:")
    y_pred_xgb = xgb_model.predict(X_test)
    print(classification_report(
        y_test, y_pred_xgb,
        labels=sorted(y_test.unique()),
        target_names=[LABEL_NAMES[l] for l in sorted(y_test.unique())],
        zero_division=0,
    ))

    # ---- Save JSON ----
    results_path = REPORTS_DIR / "evaluation_results.json"
    output = {
        "synthetic_data_warning": True,
        "n_total": len(y),
        "n_train": len(y_train),
        "n_test":  n_test,
        "disclaimer": f"Results based on SYNTHETIC dataset ({len(y)} rows). Not validated on real-world data.",
        "RandomForest": metrics_rf,
        "XGBoost":      metrics_xgb,
    }
    results_path.write_text(json.dumps(output, indent=2))
    print(f"\n[evaluate] Saved {results_path}")

    # ---- Plots ----
    print("\n[evaluate] Generating plots …")
    labels_in_test = sorted(y_test.unique())

    _plot_confusion_matrix(
        metrics_rf["confusion_matrix"], labels_in_test,
        "RF Confusion Matrix (Synthetic Test Set)",
        REPORTS_DIR / "confusion_matrix_rf.png",
    )
    _plot_confusion_matrix(
        metrics_xgb["confusion_matrix"], labels_in_test,
        "XGBoost Confusion Matrix (Synthetic Test Set)",
        REPORTS_DIR / "confusion_matrix_xgb.png",
    )
    _plot_model_comparison(metrics_rf, metrics_xgb, REPORTS_DIR / "model_comparison.png")
    _plot_feature_importance(rf_model,  "RandomForest", REPORTS_DIR / "feature_importance_rf.png")
    _plot_feature_importance(xgb_model, "XGBoost",      REPORTS_DIR / "feature_importance_xgb.png")
    _plot_class_distribution(y, y_train, y_test, REPORTS_DIR / "class_distribution.png")

    print("\n" + "=" * 60)
    print("[evaluate] DONE — All reports saved to reports/")
    print("=" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate RoadIQ risk models")
    parser.add_argument(
        "--db",
        default=str(_REPO_ROOT / "roadiq.db"),
        help="Path to roadiq.db (default: repo root/roadiq.db)",
    )
    args = parser.parse_args()
    run_evaluation(args.db)
