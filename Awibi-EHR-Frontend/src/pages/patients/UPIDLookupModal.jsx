import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, UserPlus } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import StatusBadge from '@/components/ui/StatusBadge';
import api from '@/lib/api';
import { toast } from 'sonner';

export default function UPIDLookupModal({ open, onClose }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [candidates, setCandidates] = useState([]);

  const lookup = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setResult(null);
    setCandidates([]);
    try {
      const { data } = await api.get(`/patients/resolve/${encodeURIComponent(query.trim())}`);
      if (data.register) {
        toast.error('No patient found. Register a new patient?');
        setResult({ notFound: true });
      } else {
        setResult(data);
      }
    } catch (error) {
      const response = error?.response;
      if (response?.status === 409 && response.data?.ambiguous) {
        setCandidates(response.data.candidates || []);
        setResult({ ambiguous: true, message: response.data.error });
      } else if (response?.status === 400) {
        toast.error(response.data?.error || 'Check the identifier and try again');
      } else {
        setResult({ notFound: true });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => { setQuery(''); setResult(null); setCandidates([]); onClose(); };
  const goToPatient = () => { if (result?.id) { navigate(`/dashboard/patients/${result.id}`); handleClose(); } };
  const openCandidate = (patient) => { navigate(`/dashboard/patients/${patient.id}`); handleClose(); };

  return (
    <Modal open={open} onClose={handleClose} title="Patient lookup" size="sm">
      <div className="p-6">
        <label htmlFor="patient-lookup-query" className="block text-sm font-medium text-gray-700 mb-1.5">Patient ID, Hosp No, NIN, or phone</label>
        <div className="relative mb-3">
          <input
            id="patient-lookup-query"
            value={query}
            onChange={(event) => setQuery(event.target.value.slice(0, 80))}
            onKeyDown={(event) => { if (event.key === 'Enter') lookup(); }}
            autoFocus
            inputMode="search"
            autoComplete="off"
            placeholder="Type or paste any known identifier"
            className="w-full min-h-[52px] rounded-xl border border-gray-300 bg-white pl-4 pr-12 font-mono text-base focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30"
          />
          {loading && <span className="absolute right-4 top-1/2 -translate-y-1/2"><Spinner size="sm" /></span>}
        </div>
        <p className="text-xs text-gray-500 mb-4">Phone numbers may be shared by families. Confirm the person using name and date of birth before opening the chart.</p>

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
          result.ambiguous ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <div className="font-semibold">Shared phone number</div>
                <p className="mt-1 text-xs leading-relaxed">{result.message} Use the name, date of birth, sex and hospital number below. Do not guess.</p>
              </div>
              {candidates.map((patient) => (
                <button
                  key={patient.id}
                  type="button"
                  onClick={() => openCandidate(patient)}
                  className="w-full rounded-xl border border-gray-200 bg-white p-4 text-left transition hover:border-[#2D5BFF] hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-gray-900">{patient.firstName} {patient.lastName}</div>
                      <div className="mt-0.5 text-xs font-mono text-[#2D5BFF]">{patient.mrn || patient.universalPatientId}</div>
                      <div className="mt-1 text-xs text-gray-600">
                        {patient.gender}{patient.dateOfBirth ? ` · ${calcAge(patient.dateOfBirth)} yrs · DOB ${new Date(patient.dateOfBirth).toLocaleDateString()}` : ' · Date of birth not recorded'}
                      </div>
                    </div>
                    <StatusBadge status={patient.status} />
                  </div>
                  <div className="mt-3 text-xs font-semibold text-[#2D5BFF]">Open this patient →</div>
                </button>
              ))}
            </div>
          ) : (
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
          )
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
