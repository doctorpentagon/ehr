import React from 'react';
import { Outlet } from 'react-router-dom';

export default function AuthLayout() {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left: form */}
      <div className="flex items-center justify-center p-8 lg:p-12">
        <div className="w-full max-w-md">
          <Outlet />
        </div>
      </div>

      {/* Right: nurse image (lg+ only) */}
      <div
        className="hidden lg:block relative bg-muted"
        style={{ backgroundImage: 'url(/nurse.png)', backgroundSize: 'cover', backgroundPosition: 'center' }}
      >
        <div className="absolute inset-0 bg-black/10" />
      </div>
    </div>
  );
}
