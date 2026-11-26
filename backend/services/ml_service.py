"""Lazy, fault-tolerant inference and market analytics over DuckDB."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

from backend.config import ROOT_DIR
from backend.db import duck

MODEL_PATH = ROOT_DIR / "data" / "curated" / "fare_predictor.joblib"
REPORT_PATH = ROOT_DIR / "data" / "curated" / "ml_evaluation_report.json"
QUALITY_PATH = ROOT_DIR / "data" / "curated" / "data_quality_report.json"
_ARTIFACT: dict | bool | None = None


def _artifact() -> dict | None:
    global _ARTIFACT
    if isinstance(_ARTIFACT, dict):
        return _ARTIFACT
    if _ARTIFACT is False or not MODEL_PATH.is_file():
        _ARTIFACT = False
        return None
    try:
        loaded = joblib.load(MODEL_PATH)
        if not isinstance(loaded, dict) or "model" not in loaded:
            raise ValueError("Unexpected fare model artifact format")
        _ARTIFACT = loaded
        return loaded
    except Exception:
        _ARTIFACT = False
        return None


def reload_artifact() -> None:
    """Allow deployments/tests to retry loading after a model file is restored."""
    global _ARTIFACT
    _ARTIFACT = None


def _route_key(source: str, destination: str, flight_class: str) -> str:
    return f"{source}→{destination}|{flight_class}"


def _fallback_prediction(source: str, destination: str, flight_class: str, days_left: int) -> float | None:
    con = duck.get_connection()
    try:
        row = con.execute('''SELECT days_left,median(price) FROM flights
          WHERE source_city=? AND destination_city=? AND "class"=?
          GROUP BY days_left ORDER BY abs(days_left-?) LIMIT 1''', [source,destination,flight_class,days_left]).fetchone()
        if row and row[1] is not None:
            return float(row[1])
        row = con.execute('''SELECT median(price) FROM flights WHERE source_city=? AND destination_city=? AND "class"=?''', [source,destination,flight_class]).fetchone()
        return float(row[0]) if row and row[0] is not None else None
    finally:
        con.close()


def _predict_pair(artifact: dict | None, source: str, destination: str, airline: str,
                  flight_class: str, days_left: int, stops_count: int, duration_hrs: float,
                  departure_time: str = "Morning", arrival_time: str = "Afternoon") -> tuple[float | None, float | None, float]:
    if artifact:
        stats = artifact.get("route_stats", {})
        key = _route_key(source,destination,flight_class)
        row = pd.DataFrame([{
            "source_city":source,"destination_city":destination,"airline":airline,
            "flight_class":flight_class,"departure_time":departure_time,"arrival_time":arrival_time,
            "route_pair":f"{source}→{destination}","stops_count":stops_count,
            "duration_hrs":duration_hrs,"days_left":days_left,
            "route_class_mean":stats.get("mean",{}).get(key,artifact.get("global_mean",0)),
            "route_class_median":stats.get("median",{}).get(key,artifact.get("global_median",0)),
        }])[artifact["features"]]
        try:
            value = max(0.0,float(artifact["model"].predict(row)[0]))
            mae = float(artifact.get("metrics",{}).get(artifact.get("selected_model"),{}).get("mae_inr", 0))
            return value,None,mae
        except Exception:
            pass
    fallback = _fallback_prediction(source,destination,flight_class,days_left)
    mae = 0.0
    try:
        report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
        chosen = report.get("fare_prediction",{}).get("selected_model")
        mae = float(report.get("fare_prediction",{}).get("metrics",{}).get(chosen,{}).get("mae_inr",0))
    except Exception:
        pass
    return fallback,None,mae


def predict_fare_timing(*, source_city: str, destination_city: str, airline: str,
                        flight_class: str = "Economy", days_left: int = 7,
                        current_price: float, stops_count: int = 0,
                        duration_hrs: float = 2.2, departure_time: str = "Morning",
                        arrival_time: str = "Afternoon") -> dict[str, Any]:
    days_left = max(1,min(49,int(days_left)))
    artifact = _artifact()
    fair_now, _, mae = _predict_pair(artifact,source_city,destination_city,airline,flight_class,days_left,stops_count,duration_hrs,departure_time,arrival_time)
    fair_soon, _, _ = _predict_pair(artifact,source_city,destination_city,airline,flight_class,max(1,days_left-5),stops_count,duration_hrs,departure_time,arrival_time)
    if fair_now is None:
        return {"signal":"WAIT","predicted_fair_price_inr":None,"expected_change_inr":None,
                "confidence_pct":0,"reason":"Fare history is not available for this route and cabin yet.","model_available":False}
    expected_change = float((fair_soon if fair_soon is not None else fair_now)-fair_now)
    # Buy now when today's listed fare is materially below fair value or the
    # horizon model forecasts a near-term increase beyond model noise.
    book_now = float(current_price) <= fair_now - max(25.0, mae*.35) or expected_change > max(50.0, mae*.15)
    signal = "BOOK_NOW" if book_now else "WAIT"
    discount = (fair_now-float(current_price))/max(fair_now,1)*100
    confidence = min(95.0,max(30.0,100*(1-mae/max(fair_now,1)))) if mae else 55.0
    if book_now and discount > 1:
        reason = f"Current fare ₹{current_price:,.0f} is {discount:.0f}% below predicted fair value; booking now is favorable."
    elif book_now:
        reason = f"Fares are forecast to rise by about ₹{expected_change:,.0f} over the next five days; booking now is favorable."
    else:
        reason = f"Current fare ₹{current_price:,.0f} is near or above predicted fair value and no sharp near-term rise is forecast."
    return {"signal":signal,"predicted_fair_price_inr":round(fair_now,2),
            "expected_change_inr":round(expected_change,2),"confidence_pct":round(confidence,1),
            "reason":reason,"model_available":bool(artifact)}


def attach_price_signals(flights: list[dict]) -> list[dict]:
    """Add optional signals; any model/data error leaves results unchanged."""
    if not flights:
        return flights
    if _artifact() is None:
        return flights
    try:
        for flight in flights:
            signal = predict_fare_timing(
                source_city=flight["source_city"],destination_city=flight["destination_city"],
                airline=flight["airline"],flight_class=flight.get("travel_class") or flight.get("class") or "Economy",
                days_left=int(flight["days_left"]),current_price=float(flight["price"]),
                stops_count=int(flight.get("stops_count") or 0),duration_hrs=float(flight.get("duration_hrs") or 2.2),
                departure_time=flight.get("departure_time") or "Morning",arrival_time=flight.get("arrival_time") or "Afternoon",
            )
            if signal.get("predicted_fair_price_inr") is not None:
                flight["price_signal"] = {key:signal[key] for key in ("signal","predicted_fair_price_inr","confidence_pct","reason")}
    except Exception:
        # This is an advisory enhancement; never fail a flight search because of ML.
        return flights
    return flights


def market_trends(source_city: str | None = None, destination_city: str | None = None,
                  flight_class: str = "Economy", hotel_city: str = "Mumbai") -> dict[str, Any]:
    source = source_city or "Delhi"; destination = destination_city or "Mumbai"
    con = duck.get_connection()
    try:
        daily = con.execute('''SELECT days_left, avg(price) avg_price, median(price) median_price
          FROM flights WHERE source_city=? AND destination_city=? AND "class"=?
          GROUP BY days_left ORDER BY days_left DESC''',[source,destination,flight_class]).fetchall()
        dmap = {int(day):{"avg_fare_inr":round(float(avg),2),"median_fare_inr":round(float(med),2)} for day,avg,med in daily}
        days_curve = [{"days_left":day,**dmap.get(day,{"avg_fare_inr":None,"median_fare_inr":None})} for day in range(49,0,-1)]
        airlines = con.execute('''SELECT airline,count(*) flight_count,avg(price) avg_price_inr,median(price) median_price_inr,
          avg(duration_hrs) avg_duration_hrs,avg(price/nullif(duration_hrs,0)) fare_per_flight_hour_inr
          FROM flights WHERE source_city=? AND destination_city=? AND "class"=? GROUP BY airline ORDER BY avg_price_inr''',[source,destination,flight_class]).fetchall()
        slots = con.execute('''SELECT departure_time,count(*) flight_count,avg(price) avg_price_inr,median(price) median_price_inr
          FROM flights WHERE source_city=? AND destination_city=? AND "class"=? GROUP BY departure_time''',[source,destination,flight_class]).fetchall()
        slot_order = {"Early_Morning":0,"Morning":1,"Afternoon":2,"Evening":3,"Night":4,"Late_Night":5}
        slots = sorted(slots,key=lambda r:slot_order.get(r[0],99))
        routes = con.execute('''SELECT source_city,destination_city,count(*) flight_count,avg(price) avg_fare_inr
          FROM flights WHERE "class"='Economy' GROUP BY source_city,destination_city ORDER BY flight_count DESC, avg_fare_inr LIMIT 12''').fetchall()
        hotel_cities = con.execute('''SELECT city,count(*) hotel_count,avg(total_price_per_night_inr) avg_price_per_night_inr,
          median(total_price_per_night_inr) median_price_per_night_inr,avg(rating) avg_rating,
          avg(total_price_per_night_inr/nullif(rating,0)) price_per_rating_point_inr
          FROM hotels GROUP BY city ORDER BY city''').fetchall()
        hotel_stars = con.execute('''SELECT star_rating,count(*) hotel_count,avg(total_price_per_night_inr) avg_price_per_night_inr,avg(rating) avg_rating
          FROM hotels WHERE lower(city)=lower(?) GROUP BY star_rating ORDER BY star_rating DESC''',[hotel_city]).fetchall()
        cheapest_window = min((point for point in days_curve if point["avg_fare_inr"] is not None),key=lambda r:r["avg_fare_inr"],default=None)
    finally:
        con.close()
    try: ml_report=json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    except Exception: ml_report={}
    try: dq=json.loads(QUALITY_PATH.read_text(encoding="utf-8"))
    except Exception: dq={}
    fare=ml_report.get("fare_prediction",{}); metrics=fare.get("metrics",{}); selected=fare.get("selected_model")
    rec=ml_report.get("recommender_evaluation",{})
    return {
        "route":{"source_city":source,"destination_city":destination,"flight_class":flight_class,"hotel_city":hotel_city},
        "days_left_curve":days_curve,"optimal_booking_window":{"days_left":cheapest_window["days_left"],"avg_fare_inr":cheapest_window["avg_fare_inr"]} if cheapest_window else None,
        "airline_comparison":[{"airline":r[0],"flight_count":int(r[1]),"avg_price_inr":round(float(r[2]),2),"median_price_inr":round(float(r[3]),2),"avg_duration_hrs":round(float(r[4]),2),"fare_per_flight_hour_inr":round(float(r[5]),2)} for r in airlines],
        "departure_slot_trends":[{"departure_time":r[0],"flight_count":int(r[1]),"avg_price_inr":round(float(r[2]),2),"median_price_inr":round(float(r[3]),2)} for r in slots],
        "route_price_matrix":[{"source_city":r[0],"destination_city":r[1],"route":f"{r[0]} → {r[1]}","flight_count":int(r[2]),"avg_fare_inr":round(float(r[3]),2)} for r in routes],
        "hotel_city_overview":[{"city":r[0],"hotel_count":int(r[1]),"avg_price_per_night_inr":round(float(r[2]),2),"median_price_per_night_inr":round(float(r[3]),2),"avg_rating":round(float(r[4]),2) if r[4] is not None else None,"price_per_rating_point_inr":round(float(r[5]),2) if r[5] is not None else None} for r in hotel_cities],
        "hotel_star_breakdown":[{"star_rating":float(r[0]) if r[0] is not None else None,"hotel_count":int(r[1]),"avg_price_per_night_inr":round(float(r[2]),2),"avg_rating":round(float(r[3]),2) if r[3] is not None else None} for r in hotel_stars],
        "ml_summary":{"selected_model":fare.get("model_class"),"selected_model_key":selected,"mae_inr":metrics.get(selected,{}).get("mae_inr"),"rmse_inr":metrics.get(selected,{}).get("rmse_inr"),"r2":metrics.get(selected,{}).get("r2"),"metrics":metrics,"flight_ndcg_at_5_lift":rec.get("ndcg_at_5_lift_vs_price_only",{}).get("flight"),"hotel_ndcg_at_5_lift":rec.get("ndcg_at_5_lift_vs_price_only",{}).get("hotel"),"recommender_evaluation":rec},
        "data_quality":{"flights":dq.get("datasets",{}).get("flights",{}),"hotels":dq.get("datasets",{}).get("hotels",{})},
    }
