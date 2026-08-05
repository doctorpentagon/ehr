import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Delete, Search, UserPlus } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import StatusBadge from '@/components/ui/StatusBadge';
import api from '@/lib/api';
import { toast } from 'sonner';

const KEYS = ['1','2','3','4','5','6','7','8','9','A','0','⌫'];

export default function UPIDLookupModal({ open, onClose }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const press = k => {
    if (k === '⌫') setQuery(q => q.slice(0, -1));
    else setQuery(q => (q + k).toUpperCase().slice(0, 20));
  };

  const lookup = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const { data } = await api.get(`/patients/resolve/${encodeURIComponent(query.trim())}`);
      if (data.register) {
        toast.error('No patient found. Register a new patient?');
        setResult({ notFound: true });
      } else {
        setResult(data);
      }
    } catch (_) {
      setResult({ notFound: true });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => { setQuery(''); setResult(null); onClose(); };
  const goToPatient = () => { if (result?.id) { navigate(`/dashboard/patients/${result.id}`); handleClose(); } };

  return (
    <Modal open={open} onClose={handleClose} title="Patient lookup" size="sm">
      <div className="p-6">
        {/* Display */}
        <div className="bg-gray-900 rounded-xl px-4 py-3 mb-4 min-h-[52px] flex items-center">
          <span className="font-mono text-white text-lg tracking-widest flex-1">{query || <span className="text-gray-500 text-sm font-sans font-normal">Enter Patient ID, Hosp No, NIN or phone…</span>}</span>
          {loading && <Spinner size="sm" className="!border-white !border-t-transparent" />}
        </div>

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {KEYS.map(k => (
            <button
              key={k}
              onClick={() => k === '⌫' ? press('⌫') : press(k)}
              className={`py-3 rounded-xl text-lg font-semibold transition-colors ${
                k === '⌫' ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        {/* Lookup button */}
        <button
          onClick={lookup}
          disabled={loading || !query}
          className="w-full py-3 bg-[#2D5BFF] text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-[#1a45e0] disabled:opacity-50 mb-4"
        >
          <Search size={18} />
          Lookup Patient
        </button>

        {/* Result */}
        {result && !result.notFound && (
          <div className="border border-green-200 bg-green-50 rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-gray-900">{result.firstName} {result.lastName}</div>
                <div className="text-xs font-mono text-[#2D5BFF] mt-0.5">{result.universalPatientId}</div>
                <div className="text-xs text-gray-500 mt-0.5">{result.gender} · {result.dateOfBirth ? calcAge(result.dateOfBirth) + ' yrs' : ''}</div>
                {result.hmo && <div className="text-xs text-gray-500">HMO: {result.hmo}</div>}
              </div>
              <StatusBadge status={result.status} />
            </div>
            <button onClick={goToPatient} className="mt-3 w-full py-2 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]">
              Open Patient Record
            </button>
          </div>
        )}

        {result?.notFound && (
          <div className="border border-orange-200 bg-orange-50 rounded-xl p-4 text-center">
            <div className="text-sm font-medium text-gray-900 mb-1">No patient found</div>
            <div className="text-xs text-gray-500 mb-3">No record matches "{query}"</div>
            <button onClick={() => { navigate('/dashboard/patients/add'); handleClose(); }} className="flex items-center gap-2 mx-auto px-4 py-2 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium">
              <UserPlus size={15} /> Register New Patient
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function calcAge(dob) {
  return Math.floor((Date.now() - new Date(dob)) / (365.25 * 24 * 3600 * 1000));
}
