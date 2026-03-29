'use client';

import Link from 'next/link';

interface SidebarProps {
  isOpen: boolean;
  toggleSidebar: () => void;
}

export default function Sidebar({ isOpen, toggleSidebar }: SidebarProps) {
  return (
    <>
      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 h-full w-64 bg-white shadow-lg z-40
          transform transition-transform duration-300
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0 lg:static lg:shadow-none
        `}
      >
        <div className="p-6 space-y-6">
          <h2 className="text-2xl font-bold text-gray-900">Menu</h2>

          <nav className="flex flex-col space-y-3">
            <Link href="/" className="text-gray-700 hover:text-blue-600">
              Dashboard
            </Link>

            <Link href="/projects" className="text-gray-700 hover:text-blue-600">
              Projects
            </Link>

            <Link href="/payments" className="text-gray-700 hover:text-blue-600">
              Payments
            </Link>

            <Link href="/settings" className="text-gray-700 hover:text-blue-600">
              Settings
            </Link>
          </nav>
        </div>
      </aside>

      {/* Mobile Overlay */}
      {isOpen && (
        <div
          onClick={toggleSidebar}
          className="fixed inset-0 bg-black/30 z-30 lg:hidden"
        />
      )}
    </>
  );
}