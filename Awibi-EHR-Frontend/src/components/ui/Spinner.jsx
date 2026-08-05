import React from 'react';
import clsx from 'clsx';

export default function Spinner({ size = 'md', className }) {
  const s = { sm: 'w-4 h-4 border-2', md: 'w-6 h-6 border-2', lg: 'w-10 h-10 border-3' }[size];
  return (
    <div className={clsx('animate-spin rounded-full border-blue-600 border-t-transparent', s, className)} />
  );
}
