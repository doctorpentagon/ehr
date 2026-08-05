import React from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, CheckCircle, FileText, Mic, Camera, ClipboardList, ExternalLink, Lock, PenLine } from 'lucide-react';
import { format } from 'date-fns';
import { useSelector } from 'react-redux';
import api from '@/lib/api';
import { can } from '@/lib/permissions';
import StatusBadge from '@/components/ui/StatusBadge';
import Spinner from '@/components/ui/Spinner';
import Avatar from '@/components/ui/Avatar';
import { toast } from 'sonner';

const METHOD_ICONS = { NOTE_TAKER: FileText, VOICE: Mic, OCR: Camera, QUESTIONNAIRE: ClipboardList };

export default function CaseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: encounter, isLoading } = useQuery({
    queryKey: ['case', id],
    queryFn: () => api.get(`/cases/${id}`).then(r => r.data),
  });

  const { mutate: review, isPending: reviewing } = useMutation({
    mutationFn: () => api.put(`/cases/${id}/review`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['case', id] }); toast.success('Marked as reviewed'); },
    onError: (e) => toast.error(e?.response?.data?.error || 'Failed to mark reviewed'),
  });

  const { mutate: sign, isPending: signing } = useMutation({
    mutationFn: () => api.post(`/cases/${id}/sign`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['case', id] });
      qc.invalidateQueries({ queryKey: ['cases'] });
      toast.success('Note signed. It is now part of the permanent record and cannot be edited.');
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Failed to sign note'),
  });

  const user = useSelector(s => s.auth?.user);
  const maySign = can(user?.role, user?.subRole, 'clinical_write');

  if (isLoading) return <div className="py-24 flex justify-center"><Spinner size="lg" /></div>;
  if (!encounter) return <div className="text-center py-16 text-gray-500">Encounter not found</div>;

  const Icon = METHOD_ICONS[encounter.captureMethod] || FileText;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
        <ChevronLeft size={18} /> Back
      </button>

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 bg-[#2D5BFF]/10 rounded-xl flex items-center justify-center shrink-0">
              <Icon size={20} className="text-[#2D5BFF]" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">{encounter.title}</h1>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <span className="text-xs text-gray-500">{encounter.captureMethod?.replace(/_/g,' ')}</span>
                <span className="text-xs text-gray-400">·</span>
                <span className="text-xs text-gray-500">{encounter.createdAt ? format(new Date(encounter.createdAt), 'dd MMM yyyy, hh:mm a') : ''}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={encounter.status} />
            {encounter.encounterType && (
              <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs font-medium">
                {encounter.encounterType.replace(/_/g, ' ').toLowerCase()}
              </span>
            )}
            {!encounter.signedAt && !encounter.reviewedByClinicianAt && (
              <button onClick={() => review()} disabled={reviewing} className="flex items-center gap-1.5 px-3 min-h-11 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50">
                <CheckCircle size={14} /> {reviewing ? 'Marking…' : 'Mark Reviewed'}
              </button>
            )}
            {!encounter.signedAt && maySign && (
              <button onClick={() => sign()} disabled={signing} className="flex items-center gap-1.5 px-3 min-h-11 bg-[#2D5BFF] text-white rounded-lg text-xs font-medium hover:bg-[#1a45e0] disabled:opacity-50">
                <PenLine size={14} /> {signing ? 'Signing…' : 'Sign note'}
              </button>
            )}
          </div>
        </div>

        {/* Patient link */}
        {encounter.patient && (
          <Link to={`/dashboard/patients/${encounter.patient.id}`} className="flex items-center gap-2 mt-4 p-3 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
            <Avatar name={`${encounter.patient.firstName} ${encounter.patient.lastName}`} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900">{encounter.patient.firstName} {encounter.patient.lastName}</div>
              <div className="text-xs font-mono text-[#2D5BFF]">{encounter.patient.universalPatientId}</div>
            </div>
            <ExternalLink size={14} className="text-gray-400" />
          </Link>
        )}

        {encounter.signedAt ? (
          <div className="mt-3 flex items-start gap-2 text-xs text-[#0B1F66] bg-[#2D5BFF]/5 border border-[#2D5BFF]/20 rounded-lg px-3 py-2.5">
            <Lock size={14} className="shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">
                Signed on {format(new Date(encounter.signedAt), 'dd MMM yyyy, hh:mm a')}
                {encounter.author && ` by Dr. ${encounter.author.firstName} ${encounter.author.lastName}`}
              </div>
              <div className="text-gray-600 mt-0.5">
                This note is part of the permanent clinical record. It cannot be edited or deleted —
                corrections must be recorded as a new amendment.
              </div>
            </div>
          </div>
        ) : encounter.reviewedByClinicianAt && (
          <div className="mt-3 flex items-center gap-2 text-xs text-green-600 bg-green-50 rounded-lg px-3 py-2">
            <CheckCircle size={13} /> Reviewed by clinician on {format(new Date(encounter.reviewedByClinicianAt), 'dd MMM yyyy')}
          </div>
        )}

        {encounter.doctorsOrders && (
          <div className="mt-3 border border-amber-200 bg-amber-50 rounded-lg px-3 py-2.5">
            <div className="text-xs font-semibold text-amber-900 mb-1">To do / Doctor&rsquo;s orders</div>
            <p className="text-sm text-amber-900 whitespace-pre-wrap">{encounter.doctorsOrders}</p>
          </div>
        )}
      </div>

      {/* SOAP fields */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
        {[
          ['Chief Complaint', encounter.chiefComplaint],
          ['History of Presenting Illness', encounter.history],
          ['Examination Findings', encounter.examination],
          ['Assessment / Diagnosis', encounter.assessment],
          ['Plan', encounter.plan],
          ['Notes', encounter.notes],
        ].map(([label, value]) => value ? (
          <div key={label}>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">{label}</h3>
            <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{value}</div>
          </div>
        ) : null)}

        {encounter.audioUrl && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Voice Recording</h3>
            <audio controls src={encounter.audioUrl} className="w-full rounded-lg" />
          </div>
        )}

        {encounter.transcription && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Transcription</h3>
            <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 whitespace-pre-wrap">{encounter.transcription}</div>
          </div>
        )}

        {encounter.scanUrl && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Scanned Document</h3>
            <a href={encounter.scanUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-[#2D5BFF] hover:underline">
              <Camera size={15} /> View scan <ExternalLink size={13} />
            </a>
            {encounter.ocrText && (
              <div className="mt-2 bg-gray-50 rounded-lg p-3 text-sm text-gray-700 whitespace-pre-wrap">{encounter.ocrText}</div>
            )}
          </div>
        )}

        {encounter.icdCodes?.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">ICD Codes</h3>
            <div className="flex flex-wrap gap-2">
              {encounter.icdCodes.map(code => (
                <span key={code} className="px-2.5 py-1 bg-purple-50 text-purple-700 rounded-lg text-xs font-mono font-medium">{code}</span>
              ))}
            </div>
          </div>
        )}

        {encounter.aiSuggestions && Object.keys(encounter.aiSuggestions).length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">AI Suggestions</h3>
            <div className="bg-[#2D5BFF]/5 border border-[#2D5BFF]/10 rounded-xl p-4 text-sm text-[#2D5BFF]">
              <pre className="whitespace-pre-wrap">{JSON.stringify(encounter.aiSuggestions, null, 2)}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
