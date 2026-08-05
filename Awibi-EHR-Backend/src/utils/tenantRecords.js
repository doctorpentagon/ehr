const { prisma } = require('./database');

function notFound(label) {
  return Object.assign(new Error(`${label} not found in this facility`), { statusCode: 404 });
}

async function requireTenantPatient(facilityId, patientId) {
  const patient = await prisma.patient.findFirst({ where: { id: patientId, facilityId } });
  if (!patient) throw notFound('Patient');
  return patient;
}

async function requireTenantUser(facilityId, userId) {
  const user = await prisma.user.findFirst({ where: { id: userId, facilityId, isActive: true } });
  if (!user) throw notFound('Staff member');
  return user;
}

async function requireTenantCase(facilityId, caseId, patientId) {
  const clinicalCase = await prisma.case.findFirst({
    where: { id: caseId, facilityId, ...(patientId ? { patientId } : {}) },
  });
  if (!clinicalCase) throw notFound('Case');
  return clinicalCase;
}

async function requireTenantBed(facilityId, bedId) {
  const bed = await prisma.bed.findFirst({ where: { id: bedId, facilityId } });
  if (!bed) throw notFound('Bed');
  return bed;
}

async function requireTenantAppointment(facilityId, appointmentId, patientId) {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, facilityId, ...(patientId ? { patientId } : {}) },
  });
  if (!appointment) throw notFound('Appointment');
  return appointment;
}

async function requireTenantDepartment(facilityId, departmentId) {
  const department = await prisma.department.findFirst({ where: { id: departmentId, facilityId } });
  if (!department) throw notFound('Department');
  return department;
}

module.exports = {
  requireTenantPatient,
  requireTenantUser,
  requireTenantCase,
  requireTenantBed,
  requireTenantAppointment,
  requireTenantDepartment,
};
