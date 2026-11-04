import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildRequests } from '../buildRequests';
import '../pages/StartingBuild.css';

export default function CreationSaveNotice({ requestId, inventionId, jobId, onRecovered }: { requestId: string | null; inventionId?: string; jobId?: string | null; onRecovered?: () => void }) {
  const navigate = useNavigate();
  const recovered = useRef<string | null>(null);
  const key = requestId ?? '';
  const subscribe = useCallback((listener: () => void) => buildRequests.subscribe(key, listener), [key]);
  const snapshot = useCallback(() => buildRequests.getSnapshot(key), [key]);
  const request = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => { buildRequests.start(key); }, [key]);
  useEffect(() => {
    // A server restart can lose a create whose POST never acknowledged durability.
    // Same-key recovery preserves the job ID but can allocate a new invention ID.
    if (request?.inventionId && request.jobId &&
      (inventionId && request.inventionId !== inventionId || jobId && request.jobId !== jobId)) {
      navigate(`/i/${encodeURIComponent(request.inventionId)}?job=${encodeURIComponent(request.jobId)}&request=${encodeURIComponent(key)}`, { replace: true });
    }
  }, [request?.inventionId, request?.jobId, inventionId, jobId, key, navigate]);
  useEffect(() => {
    if (request?.status === 'saved' && onRecovered && recovered.current !== key) {
      recovered.current = key;
      onRecovered();
    }
  }, [request?.status, onRecovered, key]);
  if (!request || request.status === 'saved') return null;
  const failed = request.status === 'retryable-error' || request.status === 'rejected';
  return <div className={`creation-save-notice${failed ? ' creation-save-notice--error' : ''}`} role={failed ? 'alert' : 'status'}>
    <p><strong>{failed ? 'Cloud save needs attention' : 'Saving your new build to the cloud'}</strong>
      {failed ? request.error : 'You can watch Muse work while the save is confirmed.'}</p>
    {request.status === 'retryable-error' && <button type="button" className="btn-secondary" onClick={() => buildRequests.retry(key)}>Retry save</button>}
  </div>;
}
