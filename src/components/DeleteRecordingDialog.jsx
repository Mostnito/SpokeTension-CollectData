import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Trash2, X } from "lucide-react";
import { deleteRecording } from "../lib/api.js";

export default function DeleteRecordingDialog({
  record,
  recordedAt,
  t,
  onClose,
  onDeleted,
}) {
  const dialog = useRef(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState("");

  useEffect(() => {
    dialog.current.showModal();
  }, []);

  const close = () => {
    if (!inFlight.current) onClose();
  };
  const confirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setErrorKey("");
    try {
      await deleteRecording(record.id);
      onDeleted(record.id);
    } catch (error) {
      setErrorKey(
        error.code === "METADATA_DELETE_FAILED"
          ? "deletePartialError"
          : error.code === "STORAGE_DELETE_FAILED"
            ? "deleteAudioError"
            : "deleteError",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      className="export-dialog delete-dialog"
      aria-labelledby="delete-recording-title"
      aria-describedby="delete-recording-description"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
    >
      <div className="dialog-inner">
        <div className="dialog-heading">
          <span className="dialog-icon delete-icon">
            <Trash2 size={22} />
          </span>
          <button
            type="button"
            className="icon-button"
            onClick={close}
            disabled={busy}
            aria-label={t.close}
          >
            <X size={19} />
          </button>
        </div>
        <h2 id="delete-recording-title">{t.confirmDeleteTitle}</h2>
        <p className="muted" id="delete-recording-description">
          {t.confirmDeleteDescription}
        </p>
        <div className="delete-record-preview">
          <strong>
            {record.recorder} ·{" "}
            {record.wheel_type === "front" ? t.frontWheel : t.rearWheel}
          </strong>
          <span>{recordedAt}</span>
          <span>
            {record.tension_kgf} kgf · {record.spoke_length_mm} ×{" "}
            {record.spoke_diameter_mm} mm
          </span>
        </div>
        {errorKey && (
          <div className="error-message" role="alert">
            {t[errorKey]}
          </div>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="button secondary"
            onClick={close}
            disabled={busy}
            autoFocus
          >
            {t.cancelDelete}
          </button>
          <button
            type="button"
            className="button danger"
            onClick={confirm}
            disabled={busy}
          >
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <Trash2 size={17} />
            )}
            {busy ? t.deleting : t.deleteConfirm}
          </button>
        </div>
      </div>
    </dialog>
  );
}
