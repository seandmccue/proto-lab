import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider, useParams } from 'react-router-dom';
import './index.css';
import Home from './pages/Home.tsx';
import Workspace from './pages/Workspace.tsx';
import Gallery from './pages/Gallery.tsx';
import HowItWorks from './pages/HowItWorks.tsx';
import NotFound from './pages/NotFound.tsx';

function WorkspaceRoute() { const { id } = useParams(); return <Workspace key={id} />; }

const router = createBrowserRouter([
  { path: '/', element: <Home />, errorElement: <NotFound /> },
  { path: '/i/:id', element: <WorkspaceRoute />, errorElement: <NotFound /> },
  { path: '/gallery', element: <Gallery />, errorElement: <NotFound /> },
  { path: '/how-it-works', element: <HowItWorks />, errorElement: <NotFound /> },
  { path: '*', element: <NotFound /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
