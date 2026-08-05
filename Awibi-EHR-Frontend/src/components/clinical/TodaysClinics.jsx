import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, MapPin, Users } from 'lucide-react';
import api from '@/lib/api';

/**
 * The clinics running today.
 *
 * A doctor arriving on shift should be able to see what they are running
 * without opening a settings page and working out which day it is. The one
 * running right now sits at the top and is marked, because that is the only
 * line most people will read.
 */
export default function TodaysClinics() {
  const { data } = useQuery({
    queryKey: ['clinics-today'],
    queryFn: () => api.get('/encounter-types/schedules/today').then((r) => r.data),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const clinics = data?.clinics || [];
  if (clinics.length === 0) return null;

  // Running now first, then still to come, then finished.
  const ordered = [...clinics].sort((a, b) => {
    const rank = (c) => (c.isRunningNow ? 0 : c.hasFinished ? 2 : 1);
    return rank(a) - rank(b);
  });

  return (
    <section className="bg-white rounded-xl border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-900">Clinics today</h2>
        <p className="text-xs text-gray-500">{data.day}</p>
      </div>
      <ul className="divide-y divide-gray-100">
        {ordered.map((c) => (
          <li key={c.id} className={`px-4 py-3 ${c.hasFinished ? 'opacity-55' : ''}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-900">{c.name}</span>
                  {c.isRunningNow && (
                    <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-800 font-medium rounded">
                      running now
                    </span>
                  )}
                  {c.hasFinished && <span className="text-xs text-gray-500">finished</span>}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-600 mt-1">
                  <span className="flex items-center gap-1"><Clock size={11} /> {c.startTime}–{c.endTime}</span>
                  {c.location && <span className="flex items-center gap-1"><MapPin size={11} /> {c.location}</span>}
                  {c.department && <span>{c.department}</span>}
                  {c.maxPatients && <span className="flex items-center gap-1"><Users size={11} /> max {c.maxPatients}</span>}
                </div>
                {c.doctors?.length > 0 && (
                  <div className="text-xs text-gray-500 mt-0.5">
                    {c.doctors.map((d) => `${d.firstName} ${d.lastName}`).join(', ')}
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
