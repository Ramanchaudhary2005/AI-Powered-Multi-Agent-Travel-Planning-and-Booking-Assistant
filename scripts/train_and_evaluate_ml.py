"""Train flight fare models and evaluate flight/hotel recommenders.

Split: seeded 80/20 random row split (random_state=42). Route/class fare
aggregates are cross-fitted on training folds, so each training row's fare is
never used to construct its own aggregate feature. Test aggregates use train only.
"""
from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import KFold, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
DB_PATH = ROOT / "data" / "flights.duckdb"
CURATED = ROOT / "data" / "curated"
MODEL_PATH = CURATED / "fare_predictor.joblib"
REPORT_PATH = CURATED / "ml_evaluation_report.json"
CAT = ["source_city", "destination_city", "airline", "flight_class", "departure_time", "arrival_time", "route_pair"]
NUM = ["stops_count", "duration_hrs", "days_left", "route_class_mean", "route_class_median"]
FEATURES = CAT + NUM


def route_keys(frame: pd.DataFrame) -> pd.Series:
    return frame["source_city"].astype(str) + "→" + frame["destination_city"].astype(str) + "|" + frame["flight_class"].astype(str)


def _maps(frame: pd.DataFrame) -> tuple[dict, dict, float, float]:
    keys = route_keys(frame)
    temp = pd.DataFrame({"key": keys, "price": frame["price"].astype(float)})
    grouped = temp.groupby("key")["price"]
    means, medians = grouped.mean().to_dict(), grouped.median().to_dict()
    return means, medians, float(frame["price"].mean()), float(frame["price"].median())


def add_historical_features(train: pd.DataFrame, validation: pd.DataFrame, folds: int = 5) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Build cross-fitted train aggregates and train-only validation aggregates."""
    train = train.copy().reset_index(drop=True)
    validation = validation.copy()
    oof_mean = np.zeros(len(train), dtype=float)
    oof_median = np.zeros(len(train), dtype=float)
    kf = KFold(n_splits=folds, shuffle=True, random_state=42)
    for fit_idx, hold_idx in kf.split(train):
        fit = train.iloc[fit_idx]
        means, medians, global_mean, global_median = _maps(fit)
        keys = route_keys(train.iloc[hold_idx])
        oof_mean[hold_idx] = keys.map(means).fillna(global_mean).to_numpy()
        oof_median[hold_idx] = keys.map(medians).fillna(global_median).to_numpy()
    train["route_class_mean"] = oof_mean
    train["route_class_median"] = oof_median

    means, medians, global_mean, global_median = _maps(train)
    keys = route_keys(validation)
    validation["route_class_mean"] = keys.map(means).fillna(global_mean).to_numpy()
    validation["route_class_median"] = keys.map(medians).fillna(global_median).to_numpy()
    route_stats = {"mean": means, "median": medians, "global_mean": global_mean, "global_median": global_median}
    return train, validation, route_stats


def make_preprocessor(dense: bool) -> ColumnTransformer:
    categorical = Pipeline([("imputer", SimpleImputer(strategy="most_frequent")),
                            ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=not dense))])
    numeric = Pipeline([("imputer", SimpleImputer(strategy="median")), ("scale", StandardScaler())])
    return ColumnTransformer([("categorical", categorical, CAT), ("numeric", numeric, NUM)], remainder="drop")


def metrics(y_true, pred) -> dict:
    return {"mae_inr": round(float(mean_absolute_error(y_true, pred)), 2),
            "rmse_inr": round(float(math.sqrt(mean_squared_error(y_true, pred))), 2),
            "r2": round(float(r2_score(y_true, pred)), 5)}


def dcg(relevances: list[int], k: int = 5) -> float:
    return sum((2 ** rel - 1) / math.log2(rank + 1) for rank, rel in enumerate(relevances[:k], 1))


def rank_metrics(order: list, relevance: dict, relevant_threshold: int = 2) -> tuple[float, float]:
    rel = [relevance.get(item, 0) for item in order[:5]]
    ideal = sorted(relevance.values(), reverse=True)[:5]
    ndcg = dcg(rel) / dcg(ideal) if dcg(ideal) else 0.0
    precision = sum(v >= relevant_threshold for v in rel) / 5
    return ndcg, precision


def evaluate_flight_rankers(con: duckdb.DuckDBPyConnection) -> dict:
    from backend.services.ranking_service import rank_flights
    base = con.execute('''SELECT flight_id, source_city, destination_city, airline, stops_count,
        "class" AS flight_class, departure_time, arrival_time, duration_hrs, days_left, price
        FROM flights''').fetchdf()
    groups = base.groupby(["source_city", "destination_city", "flight_class", "days_left"], sort=True)
    keys = list(groups.groups)
    rng = np.random.default_rng(42)
    chosen = rng.choice(len(keys), size=min(30, len(keys)), replace=False)
    sums = {"hybrid": [0.0, 0.0], "price_only": [0.0, 0.0]}
    query_count = 0
    for key_index in chosen:
        frame = groups.get_group(keys[int(key_index)]).copy()
        if len(frame) < 5:
            continue
        budget = float(frame["price"].quantile(.75))
        frame = frame[frame.price <= budget].copy()
        if len(frame) < 5:
            continue
        # Ground truth rewards affordability, short travel time, and fewer stops.
        p = frame.price.astype(float); dur = frame.duration_hrs.astype(float)
        price_quality = 1 - (p - p.min()) / max(1, p.max() - p.min())
        duration_quality = 1 - (dur - dur.min()) / max(0.01, dur.max() - dur.min())
        stop_quality = 1 - frame.stops_count.astype(float).clip(0, 2) / 2
        budget_fit = np.clip(1 - p / max(float(budget), 1), 0, 1)
        raw = .35 * price_quality + .20 * budget_fit + .30 * duration_quality + .15 * stop_quality
        relevance = {int(fid): int(np.clip(np.floor(score * 4), 0, 3)) for fid, score in zip(frame.flight_id, raw)}
        rows = frame.rename(columns={"flight_class": "travel_class"}).to_dict("records")
        hybrid = rank_flights(rows)["top_3"]
        # rank_flights deliberately returns top three; extend remaining slots with the same score ordering.
        from backend.services.ranking_service import _STOPS_PENALTY
        p_lo, p_hi = float(p.min()), float(p.max()); d_lo, d_hi = float(dur.min()), float(dur.max())
        scored = []
        for row in rows:
            pn = (row["price"] - p_lo) / max(1, p_hi-p_lo)
            dn = (row["duration_hrs"] - d_lo) / max(.01, d_hi-d_lo)
            scored.append((.45*pn + .30*dn + .15*_STOPS_PENALTY.get(int(row["stops_count"]),1), row["flight_id"]))
        hybrid_order = [int(fid) for _, fid in sorted(scored)[:5]]
        price_order = frame.sort_values(["price", "flight_id"]).flight_id.astype(int).tolist()[:5]
        for name, order in [("hybrid", hybrid_order), ("price_only", price_order)]:
            nd, pr = rank_metrics(order, relevance)
            sums[name][0] += nd; sums[name][1] += pr
        query_count += 1
    return {name: {"ndcg_at_5": round(values[0] / max(1, query_count), 5), "precision_at_5": round(values[1] / max(1, query_count), 5)} for name, values in sums.items()} | {"query_count": query_count}


def evaluate_hotel_rankers(con: duckdb.DuckDBPyConnection) -> dict:
    from backend.services.hotel_service import _score_rows
    cities = [row[0] for row in con.execute("SELECT DISTINCT city FROM hotels ORDER BY city").fetchall()]
    all_rows = con.execute("SELECT * FROM hotels ORDER BY hotel_id").fetchdf().to_dict("records")
    by_city = {city: [dict(row) for row in all_rows if row["city"] == city] for city in cities}
    sums = {"hybrid": [0.0, 0.0], "price_only": [0.0, 0.0], "rating_only": [0.0, 0.0]}
    query_count = 0
    for city in cities:
        city_rows = by_city[city]
        budgets = [float(np.quantile([r["total_price_per_night_inr"] for r in city_rows], q)) for q in (.45,.65,.85,.97)]
        for i, budget in enumerate(budgets):
            min_rating = [None, 3.5, 4.0, None][i]
            candidates = [r.copy() for r in city_rows if float(r["total_price_per_night_inr"]) <= budget and (min_rating is None or r.get("rating") is not None and float(r["rating"]) >= min_rating)]
            if len(candidates) < 5:
                continue
            ranked = _score_rows(candidates)
            prices = np.array([float(r["total_price_per_night_inr"]) for r in candidates])
            ratings = np.array([float(r["rating"]) if pd.notna(r.get("rating")) else 0.0 for r in candidates])
            reviews = np.log1p(np.array([int(r.get("reviews") or 0) if pd.notna(r.get("reviews")) else 0 for r in candidates]))
            pscore = 1 - (prices-prices.min()) / max(1,prices.max()-prices.min())
            budget_fit = np.clip(1 - prices / max(float(budget), 1), 0, 1)
            rscore = ratings / 5
            vscore = reviews / max(1e-9, reviews.max())
            stars = np.array([float(r["star_rating"]) if pd.notna(r.get("star_rating")) else 0.0 for r in candidates]) / 5
            rel_raw = np.nan_to_num(.25*pscore + .20*budget_fit + .30*rscore + .15*vscore + .10*stars, nan=0.0)
            relevance = {int(r["hotel_id"]): int(np.clip(np.floor(s*4),0,3)) for r,s in zip(candidates,rel_raw)}
            orders = {
                "hybrid": [int(r["hotel_id"]) for r in sorted(ranked,key=lambda r:(-r["value_score"],r["total_price_per_night_inr"]))[:5]],
                "price_only": [int(r["hotel_id"]) for r in sorted(candidates,key=lambda r:(r["total_price_per_night_inr"],r["hotel_id"]))[:5]],
                "rating_only": [int(r["hotel_id"]) for r in sorted(candidates,key=lambda r:(-(float(r["rating"]) if r.get("rating") is not None else -1),-int(r.get("reviews") or 0),r["hotel_id"]))[:5]],
            }
            for name, order in orders.items():
                nd, pr = rank_metrics(order, relevance)
                sums[name][0] += nd; sums[name][1] += pr
            query_count += 1
    return {name: {"ndcg_at_5": round(values[0] / max(1,query_count),5), "precision_at_5": round(values[1] / max(1,query_count),5)} for name,values in sums.items()} | {"query_count":query_count,"cities":cities}


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    CURATED.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(DB_PATH), read_only=True)
    try:
        frame = con.execute('''SELECT source_city,destination_city,airline,stops_count,"class" AS flight_class,
            departure_time,arrival_time,duration_hrs,days_left,price FROM flights''').fetchdf()
        hotel_recommenders = evaluate_hotel_rankers(con)
        flight_recommenders = evaluate_flight_rankers(con)
    finally:
        con.close()

    frame["route_pair"] = frame.source_city.astype(str) + "→" + frame.destination_city.astype(str)
    frame = frame.dropna(subset=["price"]).reset_index(drop=True)
    train_idx, test_idx = train_test_split(np.arange(len(frame)), test_size=.20, random_state=42)
    train_raw, test_raw = frame.iloc[train_idx].copy(), frame.iloc[test_idx].copy()
    train, test, route_stats = add_historical_features(train_raw, test_raw)
    y_train, y_test = train.price.astype(float), test.price.astype(float)

    # Choose the deployed model on an internal validation split. The final
    # 20% test partition is reserved solely for the published benchmark.
    selection_fit_raw, selection_val_raw = train_test_split(train_raw, test_size=.20, random_state=43)
    selection_fit, selection_val, _ = add_historical_features(selection_fit_raw, selection_val_raw)
    selection_ridge = Pipeline([("features", make_preprocessor(False)), ("model", Ridge(alpha=1.0))])
    selection_ridge.fit(selection_fit[FEATURES], selection_fit.price.astype(float))
    selection_gbdt = Pipeline([("features", make_preprocessor(True)), ("model", HistGradientBoostingRegressor(
        max_iter=120, learning_rate=.08, max_leaf_nodes=31, l2_regularization=1.0,
        early_stopping=True, validation_fraction=.1, random_state=42,
    ))])
    selection_gbdt.fit(selection_fit[FEATURES], selection_fit.price.astype(float))
    selection_metrics = {
        "ridge_onehot": mean_absolute_error(selection_val.price, selection_ridge.predict(selection_val[FEATURES])),
        "gradient_boosted_trees": mean_absolute_error(selection_val.price, selection_gbdt.predict(selection_val[FEATURES])),
    }
    best_name = min(selection_metrics, key=selection_metrics.get)

    # Naive route+cabin median lookup trained only on the 80% training partition.
    lookup = train.groupby(route_keys(train))["price"].median().to_dict()
    global_median = float(y_train.median())
    naive_pred = route_keys(test).map(lookup).fillna(global_median).to_numpy()

    linear = Pipeline([("features", make_preprocessor(False)), ("model", Ridge(alpha=1.0))])
    linear.fit(train[FEATURES], y_train)
    linear_pred = linear.predict(test[FEATURES])

    gbdt = Pipeline([("features", make_preprocessor(True)), ("model", HistGradientBoostingRegressor(
        max_iter=120, learning_rate=.08, max_leaf_nodes=31, l2_regularization=1.0,
        early_stopping=True, validation_fraction=.1, random_state=42,
    ))])
    gbdt.fit(train[FEATURES], y_train)
    gbdt_pred = gbdt.predict(test[FEATURES])
    benchmark = {"naive_route_class_median": metrics(y_test, naive_pred),
                 "ridge_onehot": metrics(y_test, linear_pred),
                 "gradient_boosted_trees": metrics(y_test, gbdt_pred)}
    best_pipeline = linear if best_name == "ridge_onehot" else gbdt
    estimator = best_pipeline.named_steps["model"]
    model_class = f"{estimator.__class__.__module__}.{estimator.__class__.__name__}"
    # Persist the candidate selected on the independent validation partition.
    artifact = {"model": best_pipeline, "model_class": model_class, "features": FEATURES,
                "pipeline_class": "sklearn.pipeline.Pipeline", "categorical_features": CAT, "numeric_features": NUM, "route_stats": route_stats,
                "global_mean": float(y_train.mean()), "global_median": global_median,
                "selected_model": best_name, "metrics": benchmark,
                "model_selection": {"strategy":"independent 20% validation split from training partition, random_state=43; selection does not use test partition", "validation_mae_inr":{key:round(float(value),2) for key,value in selection_metrics.items()}}}
    joblib.dump(artifact, MODEL_PATH, compress=3)

    # Evaluate predictive booking-direction decisions on held-out, exact horizon pairs.
    pair_cols = ["source_city","destination_city","airline","flight_class"]
    test_pairs = test_raw.groupby(pair_cols + ["days_left"], as_index=False).price.mean()
    test_lookup = {tuple(row[c] for c in pair_cols + ["days_left"]): float(row.price) for _,row in test_pairs.iterrows()}
    # Predictions for current and five-days-later horizons are scored by same learned model and fixed route aggregates.
    pair_rows = test_raw[test_raw.days_left >= 6].copy()
    if len(pair_rows) > 5000:
        pair_rows = pair_rows.sample(5000, random_state=42)
    now_features = pair_rows.copy(); now_features["route_pair"] = now_features.source_city.astype(str)+"→"+now_features.destination_city.astype(str)
    for col, stat in [("route_class_mean","mean"),("route_class_median","median")]:
        now_features[col] = route_keys(now_features).map(route_stats[stat]).fillna(route_stats[f"global_{stat}"])
    soon_features = now_features.copy(); soon_features["days_left"] = (soon_features.days_left-5).clip(lower=1)
    fair_now = best_pipeline.predict(now_features[FEATURES]); fair_soon = best_pipeline.predict(soon_features[FEATURES])
    observed = []
    predicted_signals = []
    for ix, row in enumerate(pair_rows.itertuples(index=False)):
        key = tuple(getattr(row,c) for c in pair_cols)
        now_day = int(row.days_left)
        later = test_lookup.get((*key,now_day-5))
        if later is None:
            continue
        actual_change = later - float(row.price)
        predicted_change = fair_soon[ix] - fair_now[ix]
        # The rule recommends booking ahead of a predicted increase; otherwise wait for a flat/falling fare.
        predicted_signals.append(predicted_change > max(25.0, .01*float(fair_now[ix])))
        observed.append(actual_change > 0)
    directional_accuracy = round(float(np.mean(np.array(predicted_signals)==np.array(observed))*100),2) if observed else None

    data_quality_path = CURATED / "data_quality_report.json"
    data_quality = json.loads(data_quality_path.read_text(encoding="utf-8")) if data_quality_path.exists() else {}
    flight_lift = flight_recommenders["hybrid"]["ndcg_at_5"] - flight_recommenders["price_only"]["ndcg_at_5"]
    hotel_lift = hotel_recommenders["hybrid"]["ndcg_at_5"] - hotel_recommenders["price_only"]["ndcg_at_5"]
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "dataset": {"flight_rows": int(len(frame)), "training_rows": int(len(train)), "test_rows": int(len(test)),
                    "split_strategy": "Seeded random 80/20 row split; random_state=42; route-class aggregates cross-fitted over 5 training folds."},
        "fare_prediction": {"target": "price (INR)", "selected_model": best_name, "model_class": model_class,
                            "metrics": benchmark, "model_selection": artifact["model_selection"], "book_now_wait_directional_accuracy_pct": directional_accuracy,
                            "directional_pair_count": len(observed)},
        "recommender_evaluation": {"flight": flight_recommenders, "hotel": hotel_recommenders,
                                   "ndcg_at_5_lift_vs_price_only": {"flight": round(flight_lift,5), "hotel": round(hotel_lift,5)}},
        "data_quality": {"flights": data_quality.get("datasets",{}).get("flights",{}),
                         "hotels": data_quality.get("datasets",{}).get("hotels",{})},
        "artifacts": {"fare_predictor": str(MODEL_PATH.relative_to(ROOT)), "evaluation_report": str(REPORT_PATH.relative_to(ROOT))},
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print("Fare model benchmark (held-out test set)")
    for name, values in benchmark.items():
        print(f"{name:28s} MAE ₹{values['mae_inr']:,.2f} | RMSE ₹{values['rmse_inr']:,.2f} | R² {values['r2']:.4f}")
    print("Recommender NDCG@5")
    for kind, results in [("Flight", flight_recommenders), ("Hotel", hotel_recommenders)]:
        print(f"{kind:8s} Hybrid {results['hybrid']['ndcg_at_5']:.4f} | Price-only {results['price_only']['ndcg_at_5']:.4f}" + (f" | Rating-only {results['rating_only']['ndcg_at_5']:.4f}" if "rating_only" in results else ""))
    print(f"Saved {MODEL_PATH} and {REPORT_PATH}")


if __name__ == "__main__":
    main()
