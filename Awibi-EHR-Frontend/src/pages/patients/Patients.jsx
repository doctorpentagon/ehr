import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { IconSearch, IconPlus, IconScan, IconUsers, IconChevronRight } from '@tabler/icons-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import EmptyState from '@/components/ui/EmptyState';
import UPIDLookupModal from './UPIDLookupModal';
import api from '@/lib/api';

const STATUS_COLORS = {
  inpatient: 'bg-blue-100 text-blue-700',
  outpatient: 'bg-green-100 text-green-700',
  emergency: 'bg-red-100 text-red-700',
  discharged: 'bg-gray-100 text-gray-600',
};

function PatientStatusBadge({ status }) {
  const cls = STATUS_COLORS[status?.toLowerCase()] || 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {status || 'Unknown'}
    </span>
  );
}

export default function Patients() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [patients, setPatients] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [page, setPage] = useState(1);
  const [upidOpen, setUpidOpen] = useState(false);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit });
      if (query) params.set('search', query);
      const res = await api.get(`/patients?${params}`);
      setPatients(res.data.patients || res.data || []);
      setTotal(res.data.total || res.data?.length || 0);
    } catch {
      setPatients([]);
    } finally {
      setLoading(false);
    }
  }, [page, query]);

  useEffect(() => { load(); }, [load]);

  const handleSearch = (e) => {
    if (e.key === 'Enter') {
      setPage(1);
      setSearchParams(query ? { q: query } : {});
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="p-4 lg:p-6 space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <IconUsers className="size-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold text-foreground">
            {total} Patient{total !== 1 ? 's' : ''}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setUpidOpen(true)}
            className="gap-1.5"
          >
            <IconScan className="size-4" />
            Patient ID lookup
          </Button>
          <Button
            size="sm"
            className="bg-[#2D5BFF] hover:bg-[#1a45e0] gap-1.5"
            onClick={() => navigate('/dashboard/patients/add')}
          >
            <IconPlus className="size-4" />
            Add Patient
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="flex gap-2 items-center">
        <div className="relative flex-1 max-w-sm">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, Hosp No or Patient ID…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleSearch}
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => { setPage(1); load(); }}>
          Search
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-neutral-100 hover:bg-neutral-100">
              <TableHead>Universal ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Gender</TableHead>
              <TableHead>Age</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : patients.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="p-0">
                  <EmptyState
                    icon={IconUsers}
                    title="No patients found"
                    description="Register your first patient or adjust the search filters."
                    action={{ label: 'Add Patient', onClick: () => navigate('/dashboard/patients/new') }}
                  />
                </TableCell>
              </TableRow>
            ) : (
              patients.map((p) => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/dashboard/patients/${p.id}`)}
                >
                  <TableCell>
                    <span className="font-mono text-sm font-semibold text-[#0B1F66]">
                      {p.universalPatientId || p.mrn || '--'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-semibold shrink-0">
                        {p.firstName?.[0]}{p.lastName?.[0]}
                      </div>
                      <span className="font-medium text-sm">
                        {p.firstName} {p.lastName}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm capitalize">{p.gender || '--'}</TableCell>
                  <TableCell className="text-sm">
                    {p.dateOfBirth
                      ? `${new Date().getFullYear() - new Date(p.dateOfBirth).getFullYear()}y`
                      : '--'}
                  </TableCell>
                  <TableCell className="text-sm">{p.phone || '--'}</TableCell>
                  <TableCell><PatientStatusBadge status={p.status} /></TableCell>
                  <TableCell>
                    <IconChevronRight className="size-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <p>Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
      <UPIDLookupModal open={upidOpen} onClose={() => setUpidOpen(false)} />
    </div>
  );
}
