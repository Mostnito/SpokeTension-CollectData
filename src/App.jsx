import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  AudioLines,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleHelp,
  Database,
  ExternalLink,
  LoaderCircle,
  Mic,
  Moon,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Sun,
  X,
} from "lucide-react";
import { translations, languages } from "./i18n.js";
import CountryFlag from "./components/CountryFlag.jsx";
import DatasetFilters from "./components/DatasetFilters.jsx";
import DatasetRecord from "./components/DatasetRecord.jsx";
import DeleteRecordingDialog from "./components/DeleteRecordingDialog.jsx";
import { SpokeRecorder } from "./audio/recorder.js";
import { exportDataset, exportFilename, downloadBlob } from "./lib/export.js";
import { request, saveRecording } from "./lib/api.js";
import { filterRecordings } from "./lib/dataset.js";

const EMPTY_FORM = {
  recorder: "",
  wheel_type: "",
  spoke_length_mm: "",
  spoke_diameter_mm: "",
  tension_kgf: "",
  temperature_c: "",
  environment: "",
};
const EMPTY_FILTERS = { recorder: "", wheel_type: "", environment: "" };
const LOCALES = { en: "en-GB", th: "th-TH", zh: "zh-TW" };
const readPreference = (key, fallback) => {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};
const storePreference = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Settings are optional in private browsing. */
  }
};
const formatDuration = (ms = 0) =>
  `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${Math.floor((ms % 1000) / 100)}`;
const formatDate = (value, language) =>
  new Intl.DateTimeFormat(LOCALES[language], {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

function WheelMark({ size = 32, className = "" }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="20" cy="20" r="3" stroke="currentColor" strokeWidth="1.5" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * Math.PI) / 6;
        return (
          <path
            key={i}
            d={`M${20 + Math.cos(a) * 3} ${20 + Math.sin(a) * 3}L${20 + Math.cos(a) * 16} ${20 + Math.sin(a) * 16}`}
            stroke="currentColor"
            strokeWidth="1.1"
          />
        );
      })}
    </svg>
  );
}

function Waveform({ samples, active }) {
  const canvas = useRef(null);
  useEffect(() => {
    const element = canvas.current;
    const draw = () => {
      const bounds = element.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      element.width = bounds.width * dpr;
      element.height = bounds.height * dpr;
      const context = element.getContext("2d");
      context.scale(dpr, dpr);
      const w = bounds.width,
        h = bounds.height;
      context.clearRect(0, 0, w, h);
      context.strokeStyle = "#253b5c";
      context.lineWidth = 1;
      context.setLineDash([2, 6]);
      for (let y = h / 4; y < h; y += h / 4) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(w, y);
        context.stroke();
      }
      context.setLineDash([]);
      context.strokeStyle = active ? "#74b7ff" : "#5895e5";
      context.lineWidth = 1.8;
      context.lineJoin = "round";
      context.beginPath();
      if (samples?.length) {
        for (let i = 0; i < samples.length; i++) {
          const x = (i / (samples.length - 1)) * w;
          const y = h / 2 + ((samples[i] - 128) / 128) * h * 0.46;
          if (i === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
      } else {
        context.moveTo(0, h / 2);
        context.lineTo(w, h / 2);
      }
      context.stroke();
    };
    draw();
    const resize = new ResizeObserver(draw);
    resize.observe(element);
    return () => resize.disconnect();
  }, [samples, active]);
  return <canvas ref={canvas} className="waveform" aria-hidden="true" />;
}

function Field({ label, unit, children, className = "" }) {
  return (
    <div className={`field ${className}`}>
      <div className="field-label">
        {label}
        <span className="required-star" aria-hidden="true">
          *
        </span>
        {unit && <span className="field-unit">{unit}</span>}
      </div>
      {children}
    </div>
  );
}

function SetupPanel({ t, onClose, onRetry }) {
  return (
    <section className="setup-panel" aria-labelledby="setup-title">
      <div className="setup-panel-heading">
        <span className="setup-symbol">
          <Settings2 size={21} />
        </span>
        <div>
          <h2 id="setup-title">{t.setupTitle}</h2>
          <p>{t.setupDescription}</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label={t.close}>
          <X size={19} />
        </button>
      </div>
      <ol className="setup-steps">
        <li>
          {t.setupStep1}{" "}
          <a
            href="https://supabase.com/dashboard"
            target="_blank"
            rel="noreferrer"
          >
            Supabase <ExternalLink size={12} />
          </a>
        </li>
        <li>{t.setupStep2}</li>
        <li>{t.setupStep3}</li>
        <li>
          {t.setupStep4}{" "}
          <a href="https://vercel.com/new" target="_blank" rel="noreferrer">
            Vercel <ExternalLink size={12} />
          </a>
        </li>
      </ol>
      <button className="button secondary setup-retry" onClick={onRetry}>
        <RotateCcw size={14} />
        {t.retry}
      </button>
    </section>
  );
}

function ExportDialog({
  records,
  archive,
  scopeLabel,
  onClose,
  t,
  onSuccess,
  refreshRecords,
}) {
  const dialog = useRef(null);
  const abort = useRef(null);
  const [format, setFormat] = useState("");
  const [mode, setMode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current.showModal();
    return () => abort.current?.abort();
  }, []);
  const close = () => {
    abort.current?.abort();
    onClose();
  };
  const run = async () => {
    setBusy(true);
    setError("");
    abort.current = new AbortController();
    try {
      const selectedFormat = mode === "audio" ? "json" : format;
      const freshRecords = records.some((row) => !row.blob)
        ? await refreshRecords(records)
        : records;
      const options = {
        mode,
        format: selectedFormat,
        archive,
        signal: abort.current.signal,
      };
      const blob = await exportDataset(freshRecords, options);
      if (abort.current.signal.aborted) return;
      downloadBlob(blob, exportFilename(freshRecords, options));
      onSuccess();
      onClose();
    } catch (err) {
      if (err.name !== "AbortError") setError(t.exportError);
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="export-dialog"
      onCancel={close}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
    >
      <div className="dialog-inner">
        <h2>{t.exportTitle}</h2>
        <p className="muted">{t.exportDescription}</p>
        <div className="export-scope">
          <Database size={16} />
          <span>{scopeLabel}</span>
          <span className="count-badge">{records.length}</span>
        </div>
        <fieldset className="export-options" disabled={busy}>
          <legend>{t.exportContent}</legend>
          {[
            ["both", t.audioAndMetadata],
            ["audio", t.audioOnly],
            ["metadata", t.metadataOnly],
          ].map(([value, label]) => (
            <label
              className={`choice ${mode === value ? "selected" : ""}`}
              key={value}
            >
              <input
                type="radio"
                name="content"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        {mode !== "audio" && (
          <fieldset className="export-options format-options" disabled={busy}>
            <legend>{t.metadataFormat}</legend>
            {["csv", "json"].map((value) => (
              <label
                className={`choice ${format === value ? "selected" : ""}`}
                key={value}
              >
                <input
                  type="radio"
                  name="format"
                  value={value}
                  checked={format === value}
                  onChange={() => setFormat(value)}
                />
                <span>{value.toUpperCase()}</span>
              </label>
            ))}
          </fieldset>
        )}
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-actions">
          <button className="button secondary" onClick={close}>
            {t.cancel}
          </button>
          <button
            className="button primary"
            disabled={busy || !mode || (mode !== "audio" && !format)}
            onClick={run}
          >
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <ArrowDownToLine size={17} />
            )}{" "}
            {busy ? t.preparingExport : t.download}
          </button>
        </div>
      </div>
    </dialog>
  );
}

export default function App() {
  const [language, setLanguage] = useState(() => {
    const stored = readPreference("spoke-language", "en");
    return translations[stored] ? stored : "en";
  });
  const [theme, setTheme] = useState(() =>
    readPreference("spoke-theme", "light"),
  );
  const [page, setPage] = useState("record");
  const [connection, setConnection] = useState("checking");
  const [showSetup, setShowSetup] = useState(false);
  const [records, setRecords] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [listError, setListError] = useState(false);
  const [status, setStatus] = useState("idle");
  const [samples, setSamples] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [audio, setAudio] = useState(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [errorKey, setErrorKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);
  const [notification, setNotification] = useState("");
  const [exportRecords, setExportRecords] = useState(null);
  const [exportArchive, setExportArchive] = useState(false);
  const [exportScopeKey, setExportScopeKey] = useState("singleRecord");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const recorder = useRef(null);
  const formElement = useRef(null);
  const retryUpload = useRef(null);
  const retryMetadata = useRef(null);
  const operation = useRef(false);
  const deletedRecordIds = useRef(new Set());
  const t = translations[language];
  const busyCapture = ["requesting", "recording", "encoding"].includes(status);
  const visibleRecords = filterRecordings(records, filters);
  const hasFilters = Object.values(filters).some(Boolean);
  const clearFilters = () => setFilters(EMPTY_FILTERS);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-Hant" : language;
    storePreference("spoke-language", language);
  }, [language]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content =
      theme === "dark" ? "#0b1220" : "#f4f7fc";
    storePreference("spoke-theme", theme);
  }, [theme]);
  useEffect(() => {
    if (!notification) return;
    const timeout = setTimeout(() => setNotification(""), 5500);
    return () => clearTimeout(timeout);
  }, [notification]);
  useEffect(() => {
    if (!audio) {
      setAudioUrl("");
      return;
    }
    const url = URL.createObjectURL(audio.blob);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audio]);
  useEffect(() => {
    const warn = (event) => {
      if (audio || busyCapture) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [audio, busyCapture]);
  useEffect(
    () => () => {
      recorder.current?.dispose();
    },
    [],
  );

  const loadRecords = async () => {
    setLoadingRecords(true);
    setListError(false);
    try {
      const result = await request("/records");
      const current = result.records.filter(
        (row) => !deletedRecordIds.current.has(row.id),
      );
      setRecords(current);
      setConnection("connected");
      return current;
    } catch {
      setListError(true);
      setConnection("error");
      return null;
    } finally {
      setLoadingRecords(false);
    }
  };
  const checkConnection = async () => {
    setConnection("checking");
    try {
      const result = await request("/status");
      if (!result.configured) setConnection("missing");
      else if (result.connected === false) setConnection("error");
      else await loadRecords();
    } catch {
      setConnection("error");
    }
  };
  useEffect(() => {
    checkConnection();
  }, []);
  useEffect(() => {
    if (page === "dataset" && connection === "connected") loadRecords();
  }, [page]);
  useEffect(() => {
    if (connection !== "connected") return;
    const timer = setInterval(loadRecords, 50 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") loadRecords();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [connection]);
  const refreshExportRecords = async (selected) => {
    const result = await request("/records");
    const current = result.records.filter(
      (row) => !deletedRecordIds.current.has(row.id),
    );
    setRecords(current);
    const ids = new Set(selected.map((row) => row.id));
    const fresh = current.filter((row) => ids.has(row.id));
    if (fresh.length !== selected.length)
      throw new Error("Recordings could not be refreshed.");
    return fresh;
  };

  const captureError = (error) => {
    if (typeof error?.code === "string" && t[error.code]) return error.code;
    const mapping = {
      NotAllowedError: "micDenied",
      PermissionDeniedError: "micDenied",
      NotFoundError: "micNotFound",
      DevicesNotFoundError: "micNotFound",
      NotReadableError: "micBusy",
      TrackStartError: "micBusy",
      NotSupportedError: "micUnsupported",
      SecurityError: "micUnsupported",
      MICROPHONE_DENIED: "micDenied",
      MICROPHONE_NOT_FOUND: "micNotFound",
      MICROPHONE_BUSY: "micBusy",
      UNSUPPORTED: "micUnsupported",
      INTERRUPTED: "micInterrupted",
    };
    return mapping[error?.code] || mapping[error?.name] || "recordingError";
  };
  const start = async () => {
    if (operation.current || busyCapture || saving) return;
    operation.current = true;
    setErrorKey("");
    setStatus("requesting");
    setSamples(null);
    setElapsed(0);
    retryUpload.current = null;
    retryMetadata.current = null;
    setPendingSave(false);
    try {
      recorder.current = new SpokeRecorder();
      await recorder.current.start({
        onWaveform: (data) => setSamples(new Uint8Array(data)),
        onInterrupted: () => {
          setStatus("idle");
          setErrorKey("micInterrupted");
          operation.current = false;
        },
      });
      if (recorder.current.status !== "recording") return;
      setAudio(null);
      setStatus("recording");
    } catch (err) {
      setStatus("idle");
      setErrorKey(captureError(err));
    } finally {
      operation.current = false;
    }
  };
  useEffect(() => {
    if (status !== "recording") return;
    const started = performance.now();
    const timer = setInterval(
      () => setElapsed(performance.now() - started),
      80,
    );
    return () => clearInterval(timer);
  }, [status]);
  const stop = async () => {
    if (operation.current || status !== "recording") return;
    operation.current = true;
    setStatus("encoding");
    setErrorKey("");
    try {
      const result = await recorder.current.stop();
      setAudio(result);
      setElapsed(result.duration_ms);
      if (result.waveform) setSamples(result.waveform);
      setStatus("ready");
    } catch (err) {
      setStatus("idle");
      setErrorKey(captureError(err));
    } finally {
      operation.current = false;
    }
  };
  const discard = () => {
    setAudio(null);
    setSamples(null);
    setElapsed(0);
    setStatus("idle");
    setConfirmDiscard(false);
    retryUpload.current = null;
    retryMetadata.current = null;
    setPendingSave(false);
    setErrorKey("");
  };
  const save = async (event) => {
    event.preventDefault();
    if (
      !audio ||
      saving ||
      connection !== "connected" ||
      !formElement.current.reportValidity()
    )
      return;
    setSaving(true);
    setErrorKey("");
    try {
      const metadata = retryMetadata.current || {
        ...form,
        spoke_length_mm: Number(form.spoke_length_mm),
        spoke_diameter_mm: Number(form.spoke_diameter_mm),
        tension_kgf: Number(form.tension_kgf),
        temperature_c: Number(form.temperature_c),
      };
      const saved = await saveRecording(metadata, audio, retryUpload.current);
      setRecords((previous) => [
        saved,
        ...previous.filter((row) => row.id !== saved.id),
      ]);
      discard();
      setForm(EMPTY_FORM);
      setNotification("saveSuccess");
    } catch (err) {
      retryUpload.current = err.reservation || null;
      if (err.reservation) {
        retryMetadata.current = {
          ...form,
          spoke_length_mm: Number(form.spoke_length_mm),
          spoke_diameter_mm: Number(form.spoke_diameter_mm),
          tension_kgf: Number(form.tension_kgf),
          temperature_c: Number(form.temperature_c),
        };
      } else retryMetadata.current = null;
      setPendingSave(Boolean(err.reservation));
      setErrorKey("saveError");
    } finally {
      setSaving(false);
    }
  };
  const filled = Object.values(form).filter((value) => value !== "").length;
  const validForm =
    filled === Object.keys(EMPTY_FORM).length &&
    ["spoke_length_mm", "spoke_diameter_mm", "tension_kgf"].every(
      (key) => Number(form[key]) > 0,
    ) &&
    Number(form.temperature_c) >= -273.15;
  const update = (name, value) =>
    setForm((previous) => ({ ...previous, [name]: value }));
  const stateLabel = {
    idle: t.readyToRecord,
    requesting: t.requestingMic,
    recording: t.recording,
    encoding: t.encoding,
    ready: t.recorded,
  }[status];
  const select = (name, label, options) => (
    <div className="select-wrap">
      <select
        id={name}
        name={name}
        aria-label={label}
        value={form[name]}
        onChange={(e) => update(name, e.target.value)}
        required
        disabled={saving || pendingSave}
      >
        <option value="" disabled>
          {label}
        </option>
        {options.map(([value, text]) => (
          <option value={value} key={value}>
            {text}
          </option>
        ))}
      </select>
      <ChevronDown size={16} />
    </div>
  );
  const numeric = (name, label, unit, placeholder, min) => (
    <Field label={<label htmlFor={name}>{label}</label>} unit={unit}>
      <input
        id={name}
        name={name}
        type="number"
        inputMode="decimal"
        step="any"
        min={min}
        placeholder={placeholder}
        value={form[name]}
        onChange={(e) => update(name, e.target.value)}
        required
        disabled={saving || pendingSave}
      />
    </Field>
  );

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <a
            className="brand"
            href="#record"
            onClick={(event) => {
              event.preventDefault();
              setPage("record");
            }}
            aria-label={`${t.appName} - ${t.appSubtitle}`}
          >
            <span className="brand-mark">
              <WheelMark size={34} />
            </span>
            <span>
              <strong>{t.appName}</strong>
            </span>
          </a>
          <div className="header-controls">
            <div
              className="language-switcher"
              role="group"
              aria-label={t.language}
            >
              {languages.map(({ value, label, country }) => (
                <button
                  key={value}
                  type="button"
                  className={`country-button${language === value ? " selected" : ""}`}
                  aria-label={label}
                  aria-pressed={language === value}
                  title={label}
                  onClick={() => setLanguage(value)}
                >
                  <CountryFlag country={country} />
                </button>
              ))}
            </div>
            <span className="control-divider" />
            <button
              className="icon-button theme-toggle"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              aria-label={theme === "light" ? t.darkMode : t.lightMode}
              title={theme === "light" ? t.darkMode : t.lightMode}
            >
              {theme === "light" ? <Moon size={19} /> : <Sun size={19} />}
            </button>
          </div>
        </div>
      </header>
      <div className="workspace">
        <div className="workspace-bar">
          <nav className="tabs" aria-label={t.appName}>
            <button
              className={page === "record" ? "active" : ""}
              onClick={() => setPage("record")}
            >
              <Mic size={16} />
              {t.recordTab}
            </button>
            <button
              className={page === "dataset" ? "active" : ""}
              onClick={() => setPage("dataset")}
              disabled={busyCapture || saving}
            >
              <Database size={16} />
              {t.datasetTab}
              {connection === "connected" && (
                <span className="tab-count">{records.length}</span>
              )}
            </button>
          </nav>
          <button
            className={`connection-status ${connection}`}
            onClick={() =>
              connection === "connected"
                ? loadRecords()
                : setShowSetup(!showSetup)
            }
            aria-expanded={connection !== "connected" ? showSetup : undefined}
          >
            {connection === "checking" ? (
              <LoaderCircle size={13} className="spin" />
            ) : (
              <span className="status-dot" />
            )}
            <span>
              {connection === "connected"
                ? t.connected
                : connection === "checking"
                  ? t.checkingConnection
                  : connection === "missing"
                    ? t.setupRequired
                    : t.connectionError}
            </span>
            {connection !== "connected" && <CircleHelp size={14} />}
          </button>
        </div>
        {showSetup && (
          <SetupPanel
            t={t}
            onClose={() => setShowSetup(false)}
            onRetry={checkConnection}
          />
        )}
        {notification && (
          <div className="toast" role="status">
            <CheckCircle2 size={18} />
            {t[notification]}
            <button
              className="icon-button"
              onClick={() => setNotification("")}
              aria-label={t.close}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {page === "record" ? (
          <main>
            <div className="capture-layout">
              <section
                className="recorder-column"
                aria-labelledby="recorder-title"
              >
                <div className="section-heading">
                  <span className="step-number">01</span>
                  <div>
                    <h2 id="recorder-title">{t.recorderTitle}</h2>
                    <p>{t.recorderDescription}</p>
                  </div>
                </div>
                <div
                  className={`recorder-panel ${status === "recording" ? "is-recording" : ""}`}
                >
                  <div className="recorder-panel-top">
                    <span className={`capture-status ${status}`}>
                      <span />
                      {stateLabel}
                    </span>
                    <AudioLines size={20} />
                  </div>
                  <div className="time-display" aria-live="off">
                    {formatDuration(elapsed)}
                  </div>
                  <div className="waveform-wrap">
                    <span className="waveform-axis">+1.0</span>
                    <Waveform
                      samples={samples}
                      active={status === "recording"}
                    />
                    <span className="waveform-axis bottom">−1.0</span>
                  </div>
                  <div className="waveform-bottom">
                    <span>
                      {audio
                        ? `${(audio.sample_rate_hz / 1000).toFixed(1)} kHz`
                        : "— kHz"}
                    </span>
                    <span>MP3 / 192 kbps</span>
                  </div>
                  <div className="record-controls">
                    {status === "recording" ? (
                      <button
                        type="button"
                        className="record-button stop"
                        onClick={stop}
                      >
                        <Square size={17} fill="currentColor" />
                        {t.stopRecording}
                      </button>
                    ) : status === "requesting" || status === "encoding" ? (
                      <button type="button" className="record-button" disabled>
                        <LoaderCircle size={19} className="spin" />
                        {stateLabel}
                      </button>
                    ) : audio ? (
                      <button
                        type="button"
                        className="record-button recorded-button"
                        onClick={() => setConfirmDiscard(true)}
                        disabled={saving}
                      >
                        <RotateCcw size={17} />
                        {t.recordAgain}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="record-button"
                        onClick={start}
                      >
                        {t.startRecording}
                      </button>
                    )}
                  </div>
                </div>
                {errorKey && errorKey !== "saveError" && (
                  <div className="error-message capture-error" role="alert">
                    {t[errorKey]}
                  </div>
                )}
                <div className="audio-specs">
                  <div>
                    <span>{t.format}</span>
                    <strong>MP3</strong>
                  </div>
                  <div>
                    <span>{t.channels}</span>
                    <strong>{t.mono}</strong>
                  </div>
                  <div>
                    <span>{t.bitrate}</span>
                    <strong>
                      192 <small>kbps</small>
                    </strong>
                  </div>
                </div>
                {audio && (
                  <div className="playback-panel">
                    <div className="playback-heading">
                      <CheckCircle2 size={17} />
                      <strong>{t.playback}</strong>
                      <span>{t.notSaved}</span>
                    </div>
                    <audio
                      controls
                      preload="metadata"
                      src={audioUrl}
                      aria-label={t.playback}
                    />
                    <div className="capture-timestamp">
                      {t.recordedAt}{" "}
                      <span>{formatDate(audio.recorded_at, language)}</span>
                    </div>
                    <button
                      className="text-button draft-export"
                      onClick={() =>
                        downloadBlob(
                          audio.blob,
                          `spoke-${audio.recorded_at.replace(/[:.]/g, "-")}.mp3`,
                        )
                      }
                    >
                      <ArrowDownToLine size={14} />
                      {t.download} MP3
                    </button>
                  </div>
                )}
              </section>
              <section
                className="metadata-column"
                aria-labelledby="metadata-title"
              >
                <div className="section-heading">
                  <span className="step-number">02</span>
                  <div>
                    <h2 id="metadata-title">{t.metadataTitle}</h2>
                    <p>{t.metadataDescription}</p>
                  </div>
                </div>
                <form
                  ref={formElement}
                  onSubmit={save}
                  className="metadata-form"
                >
                  <div className="fields-grid">
                    <Field
                      label={<label htmlFor="recorder">{t.recorder}</label>}
                    >
                      {select(
                        "recorder",
                        t.selectRecorder,
                        ["Most", "Alexander", "Sally", "Devolia"].map(
                          (name) => [name, name],
                        ),
                      )}
                    </Field>
                    <Field
                      label={<label htmlFor="wheel_type">{t.wheelType}</label>}
                    >
                      {select("wheel_type", t.selectWheel, [
                        ["front", t.frontWheel],
                        ["rear", t.rearWheel],
                      ])}
                    </Field>
                    {numeric(
                      "spoke_length_mm",
                      t.spokeLength,
                      "mm",
                      "—",
                      0.000001,
                    )}
                    {numeric(
                      "spoke_diameter_mm",
                      t.spokeDiameter,
                      "mm",
                      "—",
                      0.000001,
                    )}
                    {numeric("tension_kgf", t.tension, "kgf", "—", 0.000001)}
                    {numeric(
                      "temperature_c",
                      t.temperature,
                      "°C",
                      "—",
                      -273.15,
                    )}
                    <Field
                      label={
                        <label htmlFor="environment">{t.environment}</label>
                      }
                      className="full-width"
                    >
                      {select("environment", t.selectEnvironment, [
                        ["quiet", t.quietRoom],
                        ["noisy", t.noisyRoom],
                      ])}
                    </Field>
                  </div>
                  <div className="save-area">
                    {errorKey === "saveError" && (
                      <div className="error-message" role="alert">
                        {t[errorKey]}
                      </div>
                    )}
                    <button
                      type="submit"
                      className="button primary save-button"
                      disabled={
                        saving ||
                        !audio ||
                        !validForm ||
                        connection !== "connected" ||
                        busyCapture
                      }
                    >
                      {saving ? (
                        <LoaderCircle size={19} className="spin" />
                      ) : (
                        <></>
                      )}
                      <span>{saving ? t.saving : t.saveRecord}</span>
                      {!saving}
                    </button>
                    <p className="save-hint">
                      {connection !== "connected" ? (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setShowSetup(!showSetup)}
                        >
                          {t.connectionRequired} <ArrowRight size={12} />
                        </button>
                      ) : !audio ? (
                        t.audioRequired
                      ) : !validForm ? (
                        t.completeFormHint
                      ) : (
                        <>
                          <Check size={13} />
                          {t.requiredFields}
                        </>
                      )}
                    </p>
                  </div>
                </form>
              </section>
            </div>
          </main>
        ) : (
          <main className="dataset-page">
            <div className="page-heading dataset-heading">
              <div>
                <h1>{t.datasetTitle}</h1>
              </div>
              <button
                className="button primary"
                disabled={
                  !visibleRecords.length ||
                  loadingRecords ||
                  connection !== "connected"
                }
                onClick={() => {
                  setExportArchive(true);
                  setExportScopeKey(
                    hasFilters ? "filteredRecords" : "allRecords",
                  );
                  setExportRecords(visibleRecords);
                }}
              >
                <ArrowDownToLine size={17} />
                {hasFilters ? t.exportFiltered : t.exportAll}
              </button>
            </div>
            <DatasetFilters
              filters={filters}
              onChange={(name, value) =>
                setFilters((previous) => ({ ...previous, [name]: value }))
              }
              onClear={clearFilters}
              disabled={connection !== "connected"}
              t={t}
            />
            <div className="dataset-summary">
              <div className="dataset-total">
                <Database size={17} />
                <span>{t.totalRecordings}</span>
                <strong>
                  {connection === "connected" ? records.length : "—"}
                </strong>
              </div>
              {connection === "connected" && (
                <span className="filter-results" role="status">
                  {t.showingResults
                    .replace("{shown}", visibleRecords.length)
                    .replace("{total}", records.length)}
                </span>
              )}
              <button
                className="icon-button"
                disabled={loadingRecords}
                onClick={checkConnection}
                title={t.retry}
                aria-label={t.retry}
              >
                <RotateCcw size={16} className={loadingRecords ? "spin" : ""} />
              </button>
            </div>
            {loadingRecords ? (
              <div className="empty-state">
                <LoaderCircle className="spin" size={28} />
                <p>{t.loading}</p>
              </div>
            ) : connection !== "connected" ? (
              <div className="empty-state">
                <span className="empty-icon">
                  <Settings2 size={32} />
                </span>
                <h2>{t.setupTitle}</h2>
                <p>{t.databaseMissing}</p>
                <button
                  className="button secondary"
                  onClick={() => setShowSetup(true)}
                >
                  {t.viewSetup}
                  <ArrowRight size={16} />
                </button>
              </div>
            ) : listError ? (
              <div className="empty-state">
                <h2>{t.loadError}</h2>
                <button className="button secondary" onClick={loadRecords}>
                  <RotateCcw size={16} />
                  {t.retry}
                </button>
              </div>
            ) : records.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">
                  <AudioLines size={34} />
                </span>
                <h2>{t.emptyTitle}</h2>
                <p>{t.emptyDescription}</p>
                <button
                  className="button secondary"
                  onClick={() => setPage("record")}
                >
                  <Plus size={17} />
                  {t.makeFirstRecording}
                </button>
              </div>
            ) : visibleRecords.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">
                  <SlidersHorizontal size={30} />
                </span>
                <h2>{t.noFilterResultsTitle}</h2>
                <p>{t.noFilterResultsDescription}</p>
                <button className="button secondary" onClick={clearFilters}>
                  <X size={16} />
                  {t.clearFilters}
                </button>
              </div>
            ) : (
              <div className="records-list">
                {visibleRecords.map((row, index) => (
                  <DatasetRecord
                    key={row.id}
                    record={row}
                    number={visibleRecords.length - index}
                    recordedAt={formatDate(row.recorded_at, language)}
                    t={t}
                    onExport={(record) => {
                      setExportArchive(false);
                      setExportScopeKey("singleRecord");
                      setExportRecords([record]);
                    }}
                    onDelete={setDeleteTarget}
                  />
                ))}
              </div>
            )}
          </main>
        )}
      
      </div>
      {exportRecords && (
        <ExportDialog
          records={exportRecords}
          archive={exportArchive}
          scopeLabel={t[exportScopeKey]}
          refreshRecords={refreshExportRecords}
          t={t}
          onClose={() => setExportRecords(null)}
          onSuccess={() => setNotification("exportSuccess")}
        />
      )}
      {confirmDiscard && (
        <DiscardDialog
          t={t}
          onClose={() => setConfirmDiscard(false)}
          onConfirm={() => {
            discard();
            start();
          }}
        />
      )}
      {deleteTarget && (
        <DeleteRecordingDialog
          record={deleteTarget}
          recordedAt={formatDate(deleteTarget.recorded_at, language)}
          t={t}
          onClose={() => setDeleteTarget(null)}
          onDeleted={(id) => {
            deletedRecordIds.current.add(id);
            setRecords((previous) => previous.filter((row) => row.id !== id));
            setDeleteTarget(null);
            setNotification("deleteSuccess");
          }}
        />
      )}
    </div>
  );
}

function DiscardDialog({ t, onClose, onConfirm }) {
  const dialog = useRef(null);
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  return (
    <dialog className="export-dialog" ref={dialog} onCancel={onClose}>
      <div className="dialog-inner">
        <div className="dialog-heading">
          <span className="dialog-icon">
            <RotateCcw size={22} />
          </span>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={t.close}
          >
            <X size={19} />
          </button>
        </div>
        <h2>{t.unsavedRecording}</h2>
        <p className="muted">{t.confirmDiscard}</p>
        <div className="dialog-actions">
          <button className="button secondary" onClick={onClose}>
            {t.keepRecording}
          </button>
          <button className="button primary" onClick={onConfirm}>
            {t.recordAgain}
          </button>
        </div>
      </div>
    </dialog>
  );
}
