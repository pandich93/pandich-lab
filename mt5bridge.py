"""Pandich Lab ↔ MetaTrader 5 bridge (read-only market data).

Protocol: one JSON object per line on stdin  -> one JSON object per line on stdout.
  {"id": 1, "cmd": "init"}                                   -> terminal/account info + UTC offset
  {"id": 2, "cmd": "symbols"}                                -> Market Watch symbols
  {"id": 3, "cmd": "rates", "symbol": "XAUUSD", "tf": "15m", "count": 1500}
  {"id": 4, "cmd": "info", "symbol": "XAUUSD"}
Times are returned exactly as MT5 gives them (trade-server time, seconds); the Node side
converts to UTC with the detected offset. This script never sends trade requests.
"""
import sys
import json
import time

try:
    import MetaTrader5 as mt5
except Exception as e:  # package missing / wrong Python
    sys.stdout.write(json.dumps({"id": 0, "fatal": "import MetaTrader5 failed: %s" % e}) + "\n")
    sys.stdout.flush()
    sys.exit(2)

TF = {
    "1m": mt5.TIMEFRAME_M1, "3m": mt5.TIMEFRAME_M3, "5m": mt5.TIMEFRAME_M5, "15m": mt5.TIMEFRAME_M15,
    "30m": mt5.TIMEFRAME_M30, "1h": mt5.TIMEFRAME_H1, "2h": mt5.TIMEFRAME_H2, "4h": mt5.TIMEFRAME_H4,
    "1d": mt5.TIMEFRAME_D1, "1w": mt5.TIMEFRAME_W1, "1M": mt5.TIMEFRAME_MN1,
    "2m": mt5.TIMEFRAME_M2, "4m": mt5.TIMEFRAME_M4, "6m": mt5.TIMEFRAME_M6, "10m": mt5.TIMEFRAME_M10,
    "12m": mt5.TIMEFRAME_M12, "20m": mt5.TIMEFRAME_M20, "3h": mt5.TIMEFRAME_H3, "6h": mt5.TIMEFRAME_H6,
    "8h": mt5.TIMEFRAME_H8, "12h": mt5.TIMEFRAME_H12,
}
MAX_HOURS = 14 * 3600


def detect_offset():
    """Server-time minus UTC, rounded to 30 min, from the freshest Market Watch tick. None if no fresh tick."""
    best = 0
    for s in mt5.symbols_get() or []:
        if not s.visible:
            continue
        t = mt5.symbol_info_tick(s.name)
        if t is not None and t.time > best:
            best = t.time
    if not best:
        return None
    diff = best - time.time()
    off = int(round(diff / 1800.0) * 1800)
    if abs(off) > MAX_HOURS or abs(diff - off) > 120:  # stale tick (market closed) → can't trust it
        return None
    return off


def ok(i, data):
    return {"id": i, "ok": True, "data": data}


def err(i, msg):
    return {"id": i, "ok": False, "error": msg}


def handle(req):
    i = req.get("id")
    cmd = req.get("cmd")
    if cmd == "init":
        kw = {"path": req["path"]} if req.get("path") else {}
        if not mt5.initialize(**kw):
            return err(i, "mt5.initialize failed: %s (is the MT5 terminal running?)" % (mt5.last_error(),))
        ti = mt5.terminal_info()
        ai = mt5.account_info()
        return ok(i, {
            "terminal": ti.name if ti else None,
            "company": ti.company if ti else None,
            "connected": bool(ti.connected) if ti else False,
            "server": ai.server if ai else None,
            "login": ai.login if ai else None,
            "offset": detect_offset(),
            "version": list(mt5.version() or []),
        })
    if cmd == "offset":
        return ok(i, {"offset": detect_offset()})
    if cmd == "symbols":
        out = []
        for s in mt5.symbols_get() or []:
            if s.visible:
                out.append({"name": s.name, "desc": s.description, "digits": s.digits, "path": s.path})
        return ok(i, out)
    if cmd == "info":
        s = mt5.symbol_info(req["symbol"])
        if s is None:
            return err(i, "unknown symbol %s: %s" % (req["symbol"], mt5.last_error()))
        return ok(i, {"name": s.name, "desc": s.description, "digits": s.digits, "point": s.point,
                      "tick_size": s.trade_tick_size, "base": s.currency_base, "profit": s.currency_profit})
    if cmd == "rates":
        sym, tf, count = req["symbol"], req["tf"], int(req.get("count", 1500))
        if tf not in TF:
            return err(i, "unsupported timeframe %s" % tf)
        if not mt5.symbol_select(sym, True):
            return err(i, "symbol_select(%s) failed: %s" % (sym, mt5.last_error()))
        r = mt5.copy_rates_from_pos(sym, TF[tf], 0, max(1, min(count, 50000)))
        if r is None or len(r) == 0:
            return err(i, "no rates for %s %s: %s" % (sym, tf, mt5.last_error()))
        return ok(i, {
            "t": r["time"].tolist(), "o": r["open"].tolist(), "h": r["high"].tolist(), "l": r["low"].tolist(),
            "c": r["close"].tolist(), "tv": r["tick_volume"].tolist(), "rv": r["real_volume"].tolist(),
        })
    return err(i, "unknown cmd %s" % cmd)


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = None
        try:
            req = json.loads(line)
            res = handle(req)
        except Exception as e:  # never die on a bad request
            res = err(req.get("id") if isinstance(req, dict) else None, "%s: %s" % (type(e).__name__, e))
        sys.stdout.write(json.dumps(res) + "\n")
        sys.stdout.flush()
    mt5.shutdown()


if __name__ == "__main__":
    main()
