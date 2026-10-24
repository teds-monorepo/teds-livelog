import { Outlet } from 'react-router-dom';

export function Layout() {
  return (
    <div className="flex h-screen overflow-hidden bg-bg text-text font-sans">
      <main className="flex-1 min-w-0 flex">
        <Outlet />
      </main>
    </div>
  );
}
