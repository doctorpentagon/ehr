import React, { useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Printer, ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import api from '@/lib/api';
import Spinner from '@/components/ui/Spinner';

export default function PatientIDCard() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: patient, isLoading } = useQuery({
    queryKey: ['patient', id],
    queryFn: () => api.get(`/patients/${id}`).then(r => r.data),
  });

  const handlePrint = () => window.print();

  if (isLoading) return <div className="py-24 flex justify-center"><Spinner size="lg" /></div>;
  if (!patient) return <div className="text-center py-16 text-gray-500">Patient not found</div>;

  const age = patient.dateOfBirth
    ? Math.floor((Date.now() - new Date(patient.dateOfBirth)) / (365.25 * 24 * 3600 * 1000))
    : null;

  const initials = `${patient.firstName?.[0] || ''}${patient.lastName?.[0] || ''}`.toUpperCase();

  return (
    // Sits inside the dashboard shell, which already supplies the page padding
    // and a full-height scroll area — a second min-h-screen here pushed the
    // card below the fold on a laptop.
    <div>
      {/* Print controls — hidden on print */}
      <div className="max-w-2xl mx-auto mb-6 flex items-center gap-3 print:hidden">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-white"
        >
          <ArrowLeft size={15} /> Back
        </button>
        <button
          onClick={handlePrint}
          className="flex items-center gap-2 px-4 py-2 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]"
        >
          <Printer size={15} /> Print Card
        </button>
        <p className="text-xs text-gray-400 ml-auto">CR80 format (85.6 × 54 mm)</p>
      </div>

      {/* Card — front */}
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="bg-white rounded-2xl shadow-lg p-4 print:shadow-none" style={{ width: '100%', maxWidth: '340px', margin: '0 auto' }}>
          {/* Front of card */}
          <div
            className="relative rounded-xl overflow-hidden"
            style={{
              width: '85.6mm',
              height: '54mm',
              background: 'linear-gradient(135deg, #0B1F66 0%, #2D5BFF 60%, #335CF4 100%)',
              maxWidth: '100%',
              margin: '0 auto',
            }}
          >
            {/* Header strip */}
            <div className="absolute top-0 left-0 right-0 px-3 pt-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <img src="/logo.png" alt="Awibi" className="h-5 w-auto object-contain" onError={e => { e.target.style.display='none'; }} />
                <span className="text-white text-xs font-bold tracking-wide">Awibi EHR</span>
              </div>
              <span className="text-white/70 text-[10px] font-medium">PATIENT ID</span>
            </div>

            {/* Patient info */}
            <div className="absolute left-3 bottom-3 right-3">
              <div className="flex items-end gap-3">
                {/* Avatar circle */}
                <div className="w-10 h-10 rounded-full bg-white/20 border-2 border-white/50 flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-sm">{initials}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-bold text-sm leading-tight truncate">
                    {patient.firstName} {patient.lastName}
                  </p>
                  <p className="text-white/60 text-[10px] mt-0.5">
                    {age ? `${age} yrs` : ''} {patient.gender ? `· ${patient.gender}` : ''} {patient.bloodType ? `· ${patient.bloodType}` : ''}
                  </p>
                  {/* UPID */}
                  <div className="mt-1 bg-white/15 rounded px-1.5 py-0.5 inline-block">
                    <span className="text-white font-mono text-[11px] font-bold tracking-widest">
                      {patient.universalPatientId}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* QR code placeholder */}
            <div className="absolute right-3 top-1/2 -translate-y-1/4">
              <QRCodeSVG value={patient.universalPatientId || 'AWB-UNKNOWN'} size={44} />
            </div>
          </div>

          {/* Back of card */}
          <div
            className="relative rounded-xl overflow-hidden mt-2"
            style={{
              width: '85.6mm',
              height: '54mm',
              background: '#f8fafc',
              border: '1.5px solid #e2e8f0',
              maxWidth: '100%',
              margin: '8px auto 0',
            }}
          >
            <div className="absolute top-0 left-0 right-0 h-8 bg-[#0B1F66]" />
            <div className="px-3 pt-10 pb-3 space-y-1">
              <Row label="Patient ID" value={patient.universalPatientId} mono />
              <Row label="Hosp No" value={patient.mrn} mono />
              {patient.dateOfBirth && <Row label="DOB" value={format(new Date(patient.dateOfBirth), 'dd MMM yyyy')} />}
              {patient.nin && <Row label="NIN" value={patient.nin} mono />}
              {patient.hmo && <Row label="HMO" value={patient.hmo} />}
              {patient.phone && <Row label="Tel" value={patient.phone} />}
            </div>
            <div className="absolute bottom-2 right-3">
              <p className="text-[9px] text-gray-400">This card is property of Awibi EHR · awibi.health</p>
            </div>
          </div>
        </div>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print\\:shadow-none, .print\\:shadow-none * { visibility: visible; }
          .print\\:shadow-none { position: absolute; left: 0; top: 0; }
          @page { size: A4; margin: 20mm; }
        }
      `}</style>
    </div>
  );
}

function Row({ label, value, mono }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-gray-400 w-10 flex-shrink-0 uppercase">{label}</span>
      <span className={`text-[10px] text-gray-900 font-medium ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

// Minimal inline QR code SVG generator (no dependency)
function QRCodeSVG({ value, size = 48 }) {
  // Simple placeholder — in production replace with qrcode.react
  const modules = 21;
  const cellSize = size / modules;

  // Generate a deterministic pattern based on the value string
  const hash = value.split('').reduce((acc, c) => ((acc << 5) - acc) + c.charCodeAt(0), 0);
  const cells = Array.from({ length: modules * modules }, (_, i) => {
    const row = Math.floor(i / modules);
    const col = i % modules;
    // Always fill finder patterns (corners)
    if ((row < 7 && col < 7) || (row < 7 && col >= modules - 7) || (row >= modules - 7 && col < 7)) return true;
    // Data cells — pseudo-random from hash
    return ((hash ^ (i * 7919)) & 1) === 1;
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ background: 'white', borderRadius: 3 }}>
      <rect width={size} height={size} fill="white" />
      {cells.map((filled, i) => {
        if (!filled) return null;
        const row = Math.floor(i / modules);
        const col = i % modules;
        return (
          <rect
            key={i}
            x={col * cellSize}
            y={row * cellSize}
            width={cellSize}
            height={cellSize}
            fill="#0B1F66"
          />
        );
      })}
    </svg>
  );
}
