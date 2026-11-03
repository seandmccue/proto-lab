import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider, useParams } from 'react-router-dom';
import './index.css';
import Home from './pages/Home.tsx';
import Workspace from './pages/Workspace.tsx';
import Gallery from './pages/Gallery.tsx';

function WorkspaceRoute() { const { id } = useParams(); return <Workspace key={id} />; }

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/i/:id', element: <WorkspaceRoute /> },
  { path: '/gallery', element: <Gallery /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
