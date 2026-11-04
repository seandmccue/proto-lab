import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Header from '../components/Header';
import { buildRequests } from '../buildRequests';
import './StartingBuild.css';

export default function StartingBuild() {
  const { requestId = '' } = useParams();
  const navigate = useNavigate();
  const subscribe = useCallback((listener: () => void) => buildRequests.subscribe(requestId, listener), [requestId]);
  const snapshot = useCallback(() => buildRequests.getSnapshot(requestId), [requestId]);
  const request = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => { buildRequests.start(requestId); }, [requestId]);
  useEffect(() => {
    if (request?.inventionId && request.jobId) {
      navigate(`/i/${encodeURIComponent(request.inventionId)}?job=${encodeURIComponent(request.jobId)}&request=${encodeURIComponent(requestId)}`, { replace: true });
    }
  }, [request?.inventionId, request?.jobId, requestId, navigate]);
  const failed = request?.status === 'rejected' || request?.status === 'retryable-error';
  return <div className="starting-build-page">
    <Header />
    <main className="starting-build-shell">
      <section className="starting-build-card" aria-busy={Boolean(request && !failed)}>
        <p className="starting-build-label">AI invention workbench</p>
        <div className="starting-build-status" role="status">
          {request && !failed && <span className="starting-build-pulse" aria-hidden="true" />}
          <h1>{!request ? 'This build request is unavailable' : request.status === 'rejected' ? 'Couldn’t start this build' : failed ? 'Let’s reconnect your build' : 'Opening your live workbench'}</h1>
        </div>
        <p className="starting-build-description">{!request
          ? 'Open this link in the browser session where you started the build, or begin a new invention.'
          : failed ? request.error
          : 'Connecting your request to Muse. The workbench will open as soon as your build starts, so you can watch the parts take shape.'}</p>
        {request && <blockquote className="starting-build-brief">{request.body.prompt ?? `Starting the ${request.body.exampleId ?? 'selected'} invention.`}</blockquote>}
        <div className="starting-build-actions">
          {request?.status === 'retryable-error' && <button type="button" className="btn-primary" onClick={() => buildRequests.retry(requestId)}>Reconnect this build</button>}
          {(!request || failed) && <Link className="btn-secondary" to="/">Back to the invention prompt</Link>}
        </div>
        {request?.status === 'retryable-error' && <p className="starting-build-footnote">Reconnect uses your original request. It won’t create a duplicate.</p>}
      </section>
    </main>
  </div>;
}
