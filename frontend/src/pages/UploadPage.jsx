import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadFile } from '../api/client';
import { useJob } from '../context/JobContext';

const EXCEL_EXTENSIONS = ['.xlsx', '.xls'];

function isExcel(file) {
  return EXCEL_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
}

function formatSize(bytes) {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UploadPage() {
  const [dragging, setDragging] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const { queue, stageFiles, removeFromQueue, takeNextFromQueue, setJobId } = useJob();

  const addFiles = useCallback((fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    stageFiles(files);
  }, [stageFiles]);

  // Kicks off ingestion for the first staged file only. The rest stay in
  // the queue — ValidationResultsPage/ReviewPage advance to the next
  // queued file once the current job reaches a terminal state, keeping
  // this a sequential, one-job-at-a-time flow rather than parallel jobs.
  const startIngestion = useCallback(async () => {
    const next = takeNextFromQueue();
    if (!next) return;

    if (isExcel(next)) {
      setError(`"${next.name}" is an Excel file — Excel parsing isn't implemented yet in this prototype. Please use a CSV, or remove this file.`);
      return;
    }

    setStarting(true);
    setError(null);
    try {
      const result = await uploadFile(next);
      if (result.status === 'duplicate') {
        setError(`"${next.name}" was already processed today (job ${result.jobId}).`);
        setStarting(false);
        return;
      }
      setJobId(result.jobId);
      navigate(`/validation?job=${result.jobId}`);
    } catch (e) {
      setError(e.message);
      setStarting(false);
    }
  }, [takeNextFromQueue, setJobId, navigate]);

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Select data source</h1>
      <p style={{ color: 'var(--ink-secondary)', fontSize: 14, marginBottom: 24 }}>
        Choose where files come from, then select which ones to ingest.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <div style={{ flex: 1, padding: '14px 16px', borderRadius: 'var(--radius)', border: '1.5px solid var(--brand)', background: '#EEF0FA' }}>
          <p style={{ fontSize: 14, fontWeight: 500, margin: 0, color: 'var(--brand)' }}>Manual upload</p>
          <p style={{ fontSize: 12, color: 'var(--ink-secondary)', margin: '4px 0 0' }}>CSV from your device</p>
        </div>
        <div style={{ flex: 1, padding: '14px 16px', borderRadius: 'var(--radius)', border: '0.5px solid var(--border)', opacity: 0.6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>SharePoint / Drive</p>
            <span style={{ fontSize: 11, background: 'var(--bg)', padding: '2px 8px', borderRadius: 999, color: 'var(--ink-secondary)' }}>Bonus — not built</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink-secondary)', margin: '4px 0 0' }}>Browse a connected source</p>
        </div>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
        style={{
          border: `1.5px dashed ${dragging ? 'var(--brand)' : 'var(--border)'}`,
          borderRadius: 'var(--radius)',
          background: dragging ? '#EEF0FA' : 'var(--surface)',
          padding: '32px 24px',
          textAlign: 'center',
          marginBottom: 24,
        }}
      >
        <p style={{ fontSize: 14, marginBottom: 12 }}>Drag files here, or</p>
        <label style={{ display: 'inline-block', background: 'var(--brand)', color: 'white', fontSize: 13, fontWeight: 500, padding: '9px 18px', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}>
          Choose files
          <input type="file" accept=".csv,.xlsx,.xls" multiple style={{ display: 'none' }} onChange={(e) => addFiles(e.target.files)} />
        </label>
        <p style={{ fontSize: 12, color: 'var(--ink-secondary)', margin: '12px 0 0' }}>You can select multiple files at once</p>
      </div>

      {queue.length > 0 && (
        <>
          <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Staged for ingestion ({queue.length})</p>
          <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 12 }}>
            {queue.map((file, i) => (
              <div key={`${file.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: i < queue.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="mono" style={{ fontSize: 13, margin: 0 }}>{file.name}</p>
                  <p style={{ fontSize: 12, color: 'var(--ink-secondary)', margin: '2px 0 0' }}>{formatSize(file.size)}{isExcel(file) ? ' · Excel not yet supported' : ''}</p>
                </div>
                <span style={{ fontSize: 12, color: 'var(--ink-secondary)' }}>Queued</span>
                <button style={{ fontSize: 13, padding: '4px 8px' }} onClick={() => removeFromQueue(i)}>✕</button>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={{ fontSize: 12, color: 'var(--ink-secondary)', margin: 0 }}>
              Files are ingested one at a time — you'll review each before the next starts.
            </p>
            <button
              onClick={startIngestion}
              disabled={starting}
              style={{ background: 'var(--brand)', color: 'white', border: 'none', fontSize: 13, fontWeight: 500, padding: '9px 18px', borderRadius: 'var(--radius-sm)' }}
            >
              {starting ? 'Starting…' : `Ingest ${queue.length} file${queue.length > 1 ? 's' : ''}`}
            </button>
          </div>
        </>
      )}

      {error && <p style={{ color: 'var(--rejected-fg)', fontSize: 13, marginTop: 16 }}>{error}</p>}
    </div>
  );
}