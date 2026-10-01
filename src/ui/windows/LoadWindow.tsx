import { useLayoutEffect, useRef, useState } from "react";
import { DR_TRUST_MIN, LOAD_THRESHOLD_DEFAULT } from "../../config";
import type { LoadForecast, LoadView } from "../../core/load";
import { loadLevel } from "../../core/load";
import { loadThreshold } from "../../store/settings";
import { useStore } from "../../store/store";
import { formatZulu } from "../format";
import { useCharWidth, useElementWidth } from "../hooks";
import { binAt, chartLayout, drawLoad } from "../load/drawLoad";

function useLoad(): { load: LoadForecast | null; view: LoadView | null; threshold: number } {
  const load = useStore((s) => s.engine.predictions?.load ?? null);
  const viewId = useStore((s) => s.settings.loadView);
  const key = useStore((s) => s.engine.predictions?.airspaceKey ?? null);
  const threshold = useStore((s) => loadThreshold(s.settings, key));
  const view = load ? (viewId === "strat" ? load.strategic : load.tactical) : null;
  return { load, view, threshold };
}

export function LoadTitle() {
  const { load, view, threshold } = useLoad();
  const viewId = useStore((s) => s.settings.loadView);
  if (!load || !view) return <>LOAD</>;
  const peak = Math.max(0, ...view.bins.map((b) => b.peak));
  const level = loadLevel(peak, threshold);
  return (
    <>
      LOAD {viewId === "strat" ? "STRAT" : "TACT"} ·{" "}
      <span className={level === "normal" ? undefined : level}>PEAK {peak}</span>
    </>
  );
}

/** Keyed by airspace by the caller, so switching airspace shows that airspace's value. */
function ThresholdInput({ airspaceKey, value }: { airspaceKey: string; value: number }) {
  const setThreshold = useStore((s) => s.setLoadThreshold);
  const [text, setText] = useState(String(value));
  const n = Number(text.trim());
  const valid = /^\d{1,3}$/.test(text.trim()) && n >= 1;
  return (
    <label title={`Load threshold for this airspace (default ${LOAD_THRESHOLD_DEFAULT})`}>
      THR{" "}
      <input
        inputMode="numeric"
        size={3}
        value={text}
        aria-invalid={!valid}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value.trim());
          if (/^\d{1,3}$/.test(e.target.value.trim()) && v >= 1) setThreshold(airspaceKey, v);
        }}
        onBlur={() => !valid && setText(String(value))}
      />
    </label>
  );
}

/**
 * LOAD window (§7.4): peak simultaneous count per bin, STRAT (15 min × 2 h) or TACT
 * (5 min × 60 min), colored against the per-airspace threshold. Bins past the DR-trusted
 * horizon count RTE aircraft only and are hatched. Click a bin for its aircraft.
 */
export function LoadWindow() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = useElementWidth(wrapRef);
  const ch = useCharWidth(wrapRef);
  const { load, view, threshold } = useLoad();
  const airspaceKey = useStore((s) => s.engine.predictions?.airspaceKey ?? null);
  const viewId = useStore((s) => s.settings.loadView);
  const setView = useStore((s) => s.setLoadView);
  // Selected bin by start time, so it survives the per-poll recompute.
  const [selectedStart, setSelectedStart] = useState<number | null>(null);

  const selected = view ? view.bins.findIndex((b) => b.start === selectedStart) : -1;
  const selectedBin = view && selected >= 0 ? view.bins[selected]! : null;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view || width <= 0) return;
    const style = getComputedStyle(canvas);
    const fontPx = parseFloat(style.fontSize) || 13;
    const layout = chartLayout(view, threshold, width, ch, fontPx);
    const dpr = canvas.ownerDocument.defaultView?.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(layout.height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${layout.height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawLoad(ctx, view, layout, {
      threshold,
      selected: selected >= 0 ? selected : null,
      widthPx: width,
      font: `${style.fontSize} ${style.fontFamily}`,
    });
  }, [view, threshold, width, ch, selected]);

  if (!airspaceKey) {
    return (
      <div className="eram-list-wrap" ref={wrapRef}>
        <p className="eram-empty">NO AIRSPACE SELECTED</p>
      </div>
    );
  }

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!view) return;
    const style = getComputedStyle(e.currentTarget);
    const layout = chartLayout(view, threshold, width, ch, parseFloat(style.fontSize) || 13);
    const i = binAt(layout, view, e.nativeEvent.offsetY);
    const start = i === null ? null : view.bins[i]!.start;
    setSelectedStart(start === selectedStart ? null : start);
  };

  const members = selectedBin && load ? selectedBin.members.map((i) => load.entries[i]!) : [];
  members.sort((a, b) => a.intervals[0]![0] - b.intervals[0]![0]);

  return (
    <div className="eram-list-wrap eram-load" ref={wrapRef}>
      <div className="eram-summary" role="toolbar" aria-label="Load view">
        <button type="button" aria-pressed={viewId === "tact"} onClick={() => setView("tact")}>
          TACT
        </button>
        <button type="button" aria-pressed={viewId === "strat"} onClick={() => setView("strat")}>
          STRAT
        </button>
        <ThresholdInput key={airspaceKey} airspaceKey={airspaceKey} value={threshold} />
        {load && <span title="Aircraft inside now">NOW {load.current}</span>}
      </div>
      {!view ? (
        <p className="eram-empty">WAITING FOR DATA</p>
      ) : (
        <>
          <canvas
            ref={canvasRef}
            className="eram-load-chart"
            role="img"
            aria-label={view.bins.map((b) => `${formatZulu(b.start)} ${b.peak}`).join(", ")}
            onClick={onClick}
          />
          <p className="eram-load-note dim">
            HATCHED: RTE ONLY BEYOND {DR_TRUST_MIN} MIN · DEPARTURES NOT COUNTED
          </p>
          {selectedBin && (
            <table className="eram-list">
              <caption className="eram-load-caption">
                {formatZulu(selectedBin.start)}–{formatZulu(selectedBin.end)} · PEAK{" "}
                {selectedBin.peak} · {members.length} ACFT
              </caption>
              <thead>
                <tr>
                  <th>CALLSIGN</th>
                  <th>TYPE</th>
                  <th>ALT</th>
                  <th>IN</th>
                  <th>OUT</th>
                  <th className="col-flg">FLG</th>
                </tr>
              </thead>
              <tbody>
                {members.map((e) => {
                  const iv =
                    e.intervals.find(([a, b]) => b > selectedBin.start && a < selectedBin.end) ??
                    e.intervals[0]!;
                  const inNow = load !== null && iv[0] <= load.computedAt;
                  return (
                    <tr key={e.cid}>
                      <td>{e.callsign}</td>
                      <td>{e.aircraftType}</td>
                      <td>{String(Math.max(0, Math.round(e.altitude / 100))).padStart(3, "0")}</td>
                      <td>{inNow ? "NOW" : formatZulu(iv[0])}</td>
                      <td>
                        {iv[1] === Infinity || (e.mode === "DR" && iv[1] >= load!.trustEnd)
                          ? "----"
                          : formatZulu(iv[1])}
                      </td>
                      <td className="col-flg">{e.mode}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
