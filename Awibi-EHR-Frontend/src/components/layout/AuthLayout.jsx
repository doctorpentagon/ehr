import React from 'react';
import { Outlet } from 'react-router-dom';

export default function AuthLayout() {
  return (
    <div className="min-h-screen grid lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] bg-white">
      <div className="flex items-center justify-center p-6 sm:p-8 lg:p-12">
        <div className="w-full max-w-md">
          <Outlet />
        </div>
      </div>

      <aside className="hidden lg:block relative min-h-screen overflow-hidden bg-[#07152e]">
        <img
          src="/ehr-login-care-team.webp"
          alt="African hospital care team reviewing a digital patient record together"
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#07152e]/55 via-transparent to-[#07152e]/75" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#07152e]/25 via-transparent to-transparent" />

        <div className="relative flex h-full min-h-screen flex-col justify-between p-8 xl:p-12">
          <div className="w-fit rounded-2xl border border-white/50 bg-white/92 px-5 py-4 shadow-lg backdrop-blur-sm">
            <img src="/logo.png" alt="Awibi EHR" className="h-10 w-auto" />
          </div>

          <div className="max-w-xl rounded-3xl border border-white/20 bg-[#07152e]/72 p-7 text-white shadow-2xl backdrop-blur-md xl:p-8">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-blue-200">
              Connected hospital work
            </p>
            <h1 className="text-3xl font-semibold leading-tight xl:text-4xl">
              One clear record for every care team.
            </h1>
            <p className="mt-4 max-w-lg text-base leading-7 text-slate-100">
              Keep consultations, nursing, diagnostics, pharmacy and facility work connected around the right patient.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
