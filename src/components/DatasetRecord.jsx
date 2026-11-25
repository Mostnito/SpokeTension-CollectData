import { ArrowDownToLine, Trash2 } from "lucide-react";

export default function DatasetRecord({
  record,
  number,
  recordedAt,
  t,
  onExport,
  onDelete,
}) {
  return (
    <article className="record-row">
      <div className="record-index">{String(number).padStart(2, "0")}</div>
      <div className="record-identity">
        <div className="record-name">
          <h2>{record.recorder}</h2>
          <span className="record-wheel">
            {record.wheel_type === "front" ? t.frontWheel : t.rearWheel}
          </span>
        </div>
        <time className="record-date" dateTime={record.recorded_at}>
          {recordedAt}
        </time>
      </div>
      <dl className="record-measurements">
        <div className="record-measurement">
          <dt>{t.tension}</dt>
          <dd>
            <span>{record.tension_kgf}</span>
            <small>kgf</small>
          </dd>
        </div>
        <div className="record-measurement">
          <dt>{t.spokeDimensions}</dt>
          <dd>
            <span>
              {record.spoke_length_mm} × {record.spoke_diameter_mm}
            </span>
            <small>mm</small>
          </dd>
        </div>
        <div className="record-measurement">
          <dt>{t.temperature}</dt>
          <dd>
            <span>{record.temperature_c}</span>
            <small>°C</small>
          </dd>
        </div>
        <div className="record-measurement">
          <dt>{t.environment}</dt>
          <dd className="record-environment">
            {record.environment === "quiet" ? t.quietRoom : t.noisyRoom}
          </dd>
        </div>
      </dl>
      <audio
        className="record-player"
        controls
        preload="none"
        src={record.audio_url}
        aria-label={`${t.playback} ${record.recorder} ${recordedAt}`}
      />
      <div className="record-actions">
        <button
          type="button"
          className="button secondary record-export"
          onClick={() => onExport(record)}
        >
          <ArrowDownToLine size={16} />
          {t.export}
        </button>
        <button
          type="button"
          className="button danger-outline"
          aria-label={`${t.deleteRecord}: ${record.recorder}, ${recordedAt}`}
          onClick={() => onDelete(record)}
        >
          <Trash2 size={16} />
          {t.deleteRecord}
        </button>
      </div>
    </article>
  );
}
