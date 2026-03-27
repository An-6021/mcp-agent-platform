import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { WorkspaceList } from "./pages/WorkspaceList";
import { WorkspaceDetail } from "./pages/WorkspaceDetail";
import { WorkspaceEdit } from "./pages/WorkspaceEdit";

function LegacyWorkspaceRedirect({ suffix = "" }: { suffix?: string }) {
  const { id } = useParams<{ id: string }>();

  if (!id) {
    return <Navigate to="/services" replace />;
  }

  return <Navigate to={`/services/${id}${suffix}`} replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <div className="relative min-h-screen overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -left-20 top-0 h-72 w-72 rounded-full bg-sky-200/50 blur-3xl" />
          <div className="absolute right-0 top-16 h-80 w-80 rounded-full bg-blue-200/40 blur-3xl" />
          <div className="absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-cyan-100/50 blur-3xl" />
        </div>

        <div className="min-h-screen">
          <main className="px-4 py-8 sm:px-6 lg:px-8 xl:py-10">
            <div className="mx-auto w-full max-w-[1180px]">
              <Routes>
                <Route path="/" element={<Navigate to="/services" replace />} />
                <Route path="/services" element={<WorkspaceList />} />
                <Route path="/services/:id" element={<WorkspaceDetail />} />
                <Route path="/services/:id/edit" element={<WorkspaceEdit />} />
                <Route path="/workspaces" element={<Navigate to="/services" replace />} />
                <Route path="/workspaces/:id" element={<LegacyWorkspaceRedirect />} />
                <Route path="/workspaces/:id/edit" element={<LegacyWorkspaceRedirect suffix="/edit" />} />
              </Routes>
            </div>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}
