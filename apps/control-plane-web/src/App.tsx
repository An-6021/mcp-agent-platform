import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { motion } from "framer-motion";
import { SourcesIcon, ToolsIcon, HostedIcon } from "./components/AppIcons";
import { SourcesPage } from "./pages/SourcesPage";
import { ToolsPage } from "./pages/ToolsPage";
import { HostedPage } from "./pages/HostedPage";

// ── 导航项 ──────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { to: "/sources", label: "Sources", icon: SourcesIcon },
  { to: "/tools", label: "Tools", icon: ToolsIcon },
  { to: "/hosted", label: "Hosted", icon: HostedIcon },
] as const;

// ── 侧边导航 ────────────────────────────────────────────────────────

function SideNav() {
  return (
    <nav className="relative flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `relative flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition ${
              isActive
                ? "text-[#111]"
                : "text-[#666] hover:bg-[#fafafa] hover:text-[#111]"
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.div
                  layoutId="sidenav-active"
                  className="absolute inset-0 rounded-md bg-[#f2f2f2]"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                />
              )}
              <item.icon className="relative z-10 h-4 w-4" />
              <span className="relative z-10">{item.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

// ── 移动端顶部导航 ──────────────────────────────────────────────────

function TopNav() {
  return (
    <nav className="relative flex gap-1 overflow-x-auto lg:hidden">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `relative flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-medium transition ${
              isActive
                ? "text-[#111]"
                : "text-[#666] hover:bg-[#fafafa] hover:text-[#111]"
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.div
                  layoutId="topnav-active"
                  className="absolute inset-0 rounded-md bg-[#f2f2f2]"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                />
              )}
              <item.icon className="relative z-10 h-4 w-4" />
              <span className="relative z-10">{item.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

// ── 主应用 ──────────────────────────────────────────────────────────

export function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-white">
        {/* 顶部边框线 */}
        <header className="border-b border-[#eaeaea]">
          <div className="mx-auto flex h-12 max-w-[1100px] items-center px-4 sm:px-6">
            <span className="text-[14px] font-semibold text-[#111] tracking-tight">mcp-hub</span>
          </div>
        </header>

        <div className="mx-auto max-w-[1100px] px-4 sm:px-6">
          {/* 移动端导航 */}
          <div className="pt-4 pb-2 lg:hidden">
            <TopNav />
          </div>

          {/* 主内容区 */}
          <div className="flex gap-8 py-6 lg:py-8">
            {/* 桌面端侧边导航 */}
            <aside className="hidden w-[140px] shrink-0 lg:block">
              <div className="sticky top-8">
                <SideNav />
              </div>
            </aside>

            {/* 页面内容 */}
            <div className="min-w-0 flex-1">
              <Routes>
                <Route path="/" element={<Navigate to="/sources" replace />} />
                <Route path="/sources" element={<SourcesPage />} />
                <Route path="/tools" element={<ToolsPage />} />
                <Route path="/hosted" element={<HostedPage />} />
                <Route path="*" element={<Navigate to="/sources" replace />} />
              </Routes>
            </div>
          </div>
        </div>
      </div>
    </BrowserRouter>
  );
}
