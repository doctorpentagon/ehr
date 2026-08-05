import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { Plus, FileText, Mic, Camera, ClipboardList, Search } from 'lucide-react';
import { format } from 'date-fns';
import api from '../../lib/api';
import StatusBadge from '../../components/ui/StatusBadge';
import Avatar from '../../components/ui/Avatar';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';

const METHOD_ICONS = { NOTE_TAKER: FileText, VOICE: Mic, OCR: Camera, QUESTIONNAIRE: ClipboardList };

export default function Cases() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['cases', search, status],
    queryFn: () => api.get('/cases', { params: { search, status, limit: 20 } }).then(r => r.data),
  });

  const cases = data?.cases || data || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Encounters</h1>
          <p className="text-sm text-gray-500">All clinical encounters and case notes</p>
        </div>
        <Link to="/dashboard/cases/new" className="flex items-center gap-2 px-4 py-2 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]">
          <Plus size={16} /> New Encounter
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search encounters..." className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30 bg-gray-50" />
        </div>
        <select value={status} onChange={e => setStatus(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5BFF]/30">
          <option value="">All Status</option>
          <option value="OPEN">Open</option>
          <option value="CLOSED">Closed</option>
          <option value="REFERRED">Referred</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="py-16 flex justify-center"><Spinner size="lg" /></div>
        ) : cases.length === 0 ? (
          <EmptyState icon={FileText} title="No encounters yet" description="Start a new encounter to document a patient consultation" action={<Link to="/dashboard/cases/new" className="px-4 py-2 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium">New Encounter</Link>} />
        ) : (
          <div className="divide-y divide-gray-100">
            {cases.map(c => {
              const Icon = METHOD_ICONS[c.captureMethod] || FileText;
              return (
                <div key={c.id} onClick={() => navigate(`/dashboard/cases/${c.id}`)} className="p-4 hover:bg-gray-50 cursor-pointer transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 bg-[#2D5BFF]/10 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                      <Icon size={17} className="text-[#2D5BFF]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-gray-900 truncate">{c.title || 'Untitled encounter'}</div>
                        <StatusBadge status={c.status} />
                      </div>
                      {c.patient && (
                        <div className="flex items-center gap-2 mt-1">
                          <Avatar name={`${c.patient.firstName} ${c.patient.lastName}`} size="sm" />
                          <span className="text-sm text-gray-600">{c.patient.firstName} {c.patient.lastName}</span>
                          <span className="text-xs font-mono text-[#2D5BFF]">{c.patient.universalPatientId}</span>
                        </div>
                      )}
                      {c.chiefComplaint && <div className="text-xs text-gray-500 mt-1 line-clamp-1">{c.chiefComplaint}</div>}
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                        <span>{c.captureMethod?.replace(/_/g,' ')}</span>
                        <span>·</span>
                        <span>{c.createdAt ? format(new Date(c.createdAt), 'dd MMM yyyy') : ''}</span>
                        {c.author && <><span>·</span><span>by {c.author.firstName} {c.author.lastName}</span></>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
