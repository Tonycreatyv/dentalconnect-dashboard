import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "../components/Sidebar";
import { Topbar } from "../components/Topbar";
import { BottomNav } from "../components/BottomNav";

export const Layout = () => {
  const location = useLocation();
  const isAuthRoute = location.pathname.startsWith("/login") || location.pathname.startsWith("/register");

  if (isAuthRoute) return <Outlet />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="mx-auto flex max-w-7xl">
        {/* Desktop sidebar */}
        <aside className="hidden md:block">
          <Sidebar />
        </aside>

        {/* Main */}
        <div className="flex min-h-screen flex-1 flex-col">
          <Topbar />

          {/* padding bottom extra por el bottom nav en móvil */}
          <main className="flex-1 px-4 py-5 md:px-8 md:py-6 pb-24 md:pb-6">
            <Outlet />
          </main>
        </div>
      </div>

      {/* Mobile bottom nav */}
      <BottomNav />
    </div>
  );
};
