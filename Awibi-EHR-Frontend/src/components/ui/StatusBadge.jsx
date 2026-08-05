import React from 'react';

const MAP = {
  // Patient status
  IN_PATIENT:   'bg-blue-100 text-blue-700',
  OUT_PATIENT:  'bg-green-100 text-green-700',
  DISCHARGED:   'bg-gray-100 text-gray-600',
  DEAD:         'bg-red-100 text-red-700',
  DAMA:         'bg-orange-100 text-orange-700',
  // Appointment
  SCHEDULED:    'bg-blue-100 text-blue-700',
  CONFIRMED:    'bg-indigo-100 text-indigo-700',
  IN_PROGRESS:  'bg-yellow-100 text-yellow-700',
  COMPLETED:    'bg-green-100 text-green-700',
  CANCELLED:    'bg-red-100 text-red-700',
  NO_SHOW:      'bg-gray-100 text-gray-600',
  // Lab
  PENDING:      'bg-yellow-100 text-yellow-700',
  // Case
  OPEN:         'bg-blue-100 text-blue-700',
  CLOSED:       'bg-gray-100 text-gray-600',
  REFERRED:     'bg-purple-100 text-purple-700',
  // Payment
  UNPAID:       'bg-red-100 text-red-700',
  PART_PAID:    'bg-orange-100 text-orange-700',
  PAID:         'bg-green-100 text-green-700',
  // Bed
  AVAILABLE:    'bg-green-100 text-green-700',
  OCCUPIED:     'bg-red-100 text-red-700',
  MAINTENANCE:  'bg-yellow-100 text-yellow-700',
  // Admission
  ADMITTED:     'bg-blue-100 text-blue-700',
  TRANSFERRED:  'bg-purple-100 text-purple-700',
  DECEASED:     'bg-red-100 text-red-700',
  // Allergy severity
  MILD:         'bg-yellow-100 text-yellow-700',
  MODERATE:     'bg-orange-100 text-orange-700',
  SEVERE:       'bg-red-100 text-red-700',
  // Generic
  ACTIVE:       'bg-green-100 text-green-700',
  INACTIVE:     'bg-gray-100 text-gray-600',
  CHRONIC:      'bg-purple-100 text-purple-700',
  RESOLVED:     'bg-teal-100 text-teal-700',
};

export default function StatusBadge({ status, label }) {
  const cls = MAP[status] || 'bg-gray-100 text-gray-600';
  const text = label || status?.replace(/_/g, ' ');
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {text}
    </span>
  );
}
