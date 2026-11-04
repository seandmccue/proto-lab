import React, { useLayoutEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, Outlet, RouterProvider, useLocation, useNavigationType, useParams } from 'react-router-dom';
import './index.css';
import Home from './pages/Home.tsx';
import Workspace from './pages/Workspace.tsx';
import Gallery from './pages/Gallery.tsx';
import HowItWorks from './pages/HowItWorks.tsx';
import NotFound from './pages/NotFound.tsx';

function WorkspaceRoute() {
  const { id } = useParams();
  return <Workspace key={id} />;
}

function watchPageLayout(onResize: () => void, onFinish?: (timedOut: boolean) => void) {
  const page = document.getElementById('root')?.firstElementChild;
  if (!page) {
    onFinish?.(true);
    return;
  }
  const observer = new ResizeObserver(onResize);
  const cancel = () => finish(false);
  const timer = window.setTimeout(() => finish(true), 5000);
  let stopped = false;
  function finish(timedOut: boolean) {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    window.clearTimeout(timer);
    window.removeEventListener('wheel', cancel);
    window.removeEventListener('pointerdown', cancel);
    window.removeEventListener('keydown', cancel);
    onFinish?.(timedOut);
  }
  observer.observe(page);
  window.addEventListener('wheel', cancel, { passive: true });
  window.addEventListener('pointerdown', cancel, { passive: true });
  window.addEventListener('keydown', cancel);
  return cancel;
}

function RouteLayout() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const active = useRef(location);
  const positions = useRef(new Map<string, number>());
  const restoring = useRef(false);
  const stopAnchor = useRef<(() => void) | undefined>(undefined);
  const alignHash = (hash: string) => {
    stopAnchor.current?.();
    const anchor = document.getElementById(hash.slice(1));
    if (!anchor) return;
    const align = () => anchor.scrollIntoView({ block: 'start' });
    align();
    // Content arriving above an anchor can push its heading out of view.
    stopAnchor.current = watchPageLayout(align);
  };

  useLayoutEffect(() => {
    const previousSetting = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    const remember = () => {
      if (!restoring.current) positions.current.set(active.current.key, window.scrollY);
    };
    const handleHash = () => alignHash(window.location.hash);
    window.addEventListener('scroll', remember, { passive: true });
    window.addEventListener('click', remember, true);
    window.addEventListener('hashchange', handleHash);
    handleHash();
    return () => {
      window.removeEventListener('scroll', remember);
      window.removeEventListener('click', remember, true);
      window.removeEventListener('hashchange', handleHash);
      stopAnchor.current?.();
      history.scrollRestoration = previousSetting;
    };
  }, []);

  useLayoutEffect(() => {
    const previous = active.current;
    active.current = location;
    if (previous.key === location.key) return;
    if (location.hash) {
      alignHash(location.hash);
      return;
    }
    stopAnchor.current?.();
    const samePageFilter = previous.pathname === location.pathname && previous.search !== location.search;
    if (!samePageFilter && navigationType !== 'POP') {
      window.scrollTo(0, 0);
      return;
    }

    const target = positions.current.get(samePageFilter ? previous.key : location.key) ?? 0;
    const reachable = () => document.documentElement.scrollHeight - window.innerHeight >= target - 1;
    if (reachable()) {
      window.scrollTo(0, target);
      return;
    }

    // Gallery cards arrive after navigation. Wait until the saved offset can be reached.
    restoring.current = true;
    const stop = watchPageLayout(() => {
      if (!reachable()) return;
      stop?.();
      window.scrollTo(0, target);
    }, (timedOut) => {
      restoring.current = false;
      if (timedOut) window.scrollTo(0, target);
    });
    return stop;
  }, [location, navigationType]);

  return <Outlet />;
}

const router = createBrowserRouter([{ element: <RouteLayout />, children: [
  { path: '/', element: <Home />, errorElement: <NotFound /> },
  { path: '/i/:id', element: <WorkspaceRoute />, errorElement: <NotFound /> },
  { path: '/gallery', element: <Gallery />, errorElement: <NotFound /> },
  { path: '/how-it-works', element: <HowItWorks />, errorElement: <NotFound /> },
  { path: '*', element: <NotFound /> },
] }]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
