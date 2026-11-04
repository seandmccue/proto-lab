import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom';
import Header from '../components/Header.tsx';

/** Route error boundary: a friendly page for unknown URLs and for render errors instead of the router's default dump. */
export default function NotFound() {
  const err = useRouteError();
  const notFound = !err || (isRouteErrorResponse(err) && err.status === 404);
  const message = notFound ? 'That page doesn’t exist.' : err instanceof Error ? err.message : 'Something went wrong while rendering this page.';
  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-2xl px-4 py-20 text-center">
        <p className="text-xs font-mono uppercase tracking-widest text-muted">{notFound ? '404' : 'Error'}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{notFound ? 'Nothing to invent here' : 'The workshop hit a snag'}</h1>
        <p className="mt-3 text-muted">{message}</p>
        <div className="mt-8 flex justify-center gap-3">
          <Link to="/" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent">Start a new invention</Link>
          <Link to="/gallery" className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-surface2">Browse the gallery</Link>
        </div>
      </main>
    </div>
  );
}
