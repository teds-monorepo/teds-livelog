import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout.jsx';
import { LiveLogPage } from './pages/LiveLogPage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<LiveLogPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
