const PDFDocument = require('pdfkit');

// Naira. PDFKit's standard fonts are WinAnsi-encoded and cannot render "₦",
// so the ASCII prefix is deliberate — a missing glyph on a financial document
// is worse than a plain currency code.
const CURRENCY = 'NGN';

function money(value) {
  const n = Number(value || 0);
  return `${CURRENCY} ${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d) {
  // ASCII only: PDFKit's built-in fonts are WinAnsi and a missing glyph on an
  // invoice looks like a defect.
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const BLUE = '#2D5BFF';
const DARK = '#0B1F66';
const GREY = '#6b7280';

/**
 * Render an itemised invoice PDF.
 *
 * Returns a Buffer so the caller decides whether to stream, store or email it.
 */
function buildInvoicePdf({ invoice, facility, patient, household, insurance, items, responsibleParty }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;

    // ── Header ──────────────────────────────────────────────────────────────
    doc.fillColor(DARK).fontSize(18).font('Helvetica-Bold')
      .text(facility?.name || 'Facility', left, 48);
    doc.fontSize(9).font('Helvetica').fillColor(GREY);
    const facilityLines = [facility?.address, [facility?.lga, facility?.state].filter(Boolean).join(', '),
      facility?.phone, facility?.email].filter(Boolean);
    facilityLines.forEach((line) => doc.text(line, left, doc.y));

    doc.fontSize(22).font('Helvetica-Bold').fillColor(BLUE)
      .text('INVOICE', left, 48, { width: pageWidth, align: 'right' });
    doc.fontSize(9).font('Helvetica').fillColor(GREY)
      .text(`No. ${invoice.invoiceNumber}`, left, 74, { width: pageWidth, align: 'right' })
      .text(`Issued ${formatDate(invoice.createdAt)}`, left, doc.y, { width: pageWidth, align: 'right' });
    if (invoice.dueDate) {
      doc.text(`Due ${formatDate(invoice.dueDate)}`, left, doc.y, { width: pageWidth, align: 'right' });
    }

    doc.moveTo(left, 128).lineTo(left + pageWidth, 128).strokeColor('#e5e7eb').lineWidth(1).stroke();

    // ── Patient / billing party ─────────────────────────────────────────────
    let y = 142;
    doc.fontSize(8).font('Helvetica-Bold').fillColor(GREY).text('PATIENT', left, y);
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#111827')
      .text(`${patient.firstName} ${patient.lastName}`, left, y + 13);
    doc.fontSize(9).font('Helvetica').fillColor(GREY);
    let py = y + 27;
    doc.text(`UPID ${patient.universalPatientId}`, left, py); py += 12;
    if (patient.mrn) { doc.text(`MRN ${patient.mrn}`, left, py); py += 12; }
    if (patient.phone) { doc.text(patient.phone, left, py); py += 12; }
    if (household) { doc.text(`Household: ${household.name}`, left, py); py += 12; }

    // Responsible party differs from the patient when a dependant's bill is
    // directed to the household principal.
    const rightX = left + pageWidth / 2;
    doc.fontSize(8).font('Helvetica-Bold').fillColor(GREY).text('BILL TO', rightX, y);
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#111827')
      .text(responsibleParty
        ? `${responsibleParty.firstName} ${responsibleParty.lastName}`
        : `${patient.firstName} ${patient.lastName}`, rightX, y + 13);
    doc.fontSize(9).font('Helvetica').fillColor(GREY);
    let ry = y + 27;
    if (responsibleParty) {
      doc.text('Household principal', rightX, ry); ry += 12;
      doc.text(`UPID ${responsibleParty.universalPatientId}`, rightX, ry); ry += 12;
    }
    if (insurance) {
      doc.fillColor(DARK).font('Helvetica-Bold').text(insurance.provider, rightX, ry); ry += 12;
      doc.fillColor(GREY).font('Helvetica');
      if (insurance.planName) { doc.text(insurance.planName, rightX, ry); ry += 12; }
      if (insurance.policyNumber) { doc.text(`Policy ${insurance.policyNumber}`, rightX, ry); ry += 12; }
      const cover = Object.entries(insurance.coverageDetails || {})
        .map(([k, v]) => `${k}: ${v}`).join('   |   ');
      if (cover) {
        doc.fontSize(8).text(cover, rightX, ry, { width: pageWidth / 2 - 4 });
        ry = doc.y + 2;
      }
      if (insurance.authorizationRequired) {
        doc.fontSize(8).fillColor('#b45309').text('Pre-authorisation required', rightX, ry);
        ry += 11;
      }
    }

    // ── Items table ─────────────────────────────────────────────────────────
    y = Math.max(py, ry) + 14;
    const cols = { desc: left, qty: left + pageWidth - 200, unit: left + pageWidth - 140, amount: left + pageWidth - 70 };

    doc.rect(left, y, pageWidth, 22).fill('#f3f4f6');
    doc.fillColor(GREY).fontSize(8).font('Helvetica-Bold');
    doc.text('DESCRIPTION', cols.desc + 6, y + 7);
    doc.text('QTY', cols.qty, y + 7, { width: 40, align: 'right' });
    doc.text('UNIT', cols.unit, y + 7, { width: 60, align: 'right' });
    doc.text('AMOUNT', cols.amount, y + 7, { width: 70, align: 'right' });
    y += 22;

    doc.font('Helvetica').fontSize(9);
    let lastCategory = null;
    for (const item of items) {
      if (y > doc.page.height - 170) { doc.addPage(); y = 56; }

      if (item.category && item.category !== lastCategory) {
        doc.fillColor(BLUE).fontSize(8).font('Helvetica-Bold')
          .text(item.category.toUpperCase(), cols.desc + 6, y + 5);
        y += 16;
        lastCategory = item.category;
        doc.font('Helvetica').fontSize(9);
      }

      const qty = Number(item.quantity || 1);
      const unit = Number(item.unitPrice ?? item.price ?? 0);
      const amount = Number(item.amount ?? qty * unit);

      doc.fillColor('#111827').text(item.description || item.name || 'Item', cols.desc + 6, y + 4, { width: pageWidth - 220 });
      doc.fillColor(GREY);
      doc.text(String(qty), cols.qty, y + 4, { width: 40, align: 'right' });
      doc.text(unit.toLocaleString('en-NG', { minimumFractionDigits: 2 }), cols.unit, y + 4, { width: 60, align: 'right' });
      doc.fillColor('#111827').text(amount.toLocaleString('en-NG', { minimumFractionDigits: 2 }), cols.amount, y + 4, { width: 70, align: 'right' });

      y = Math.max(y + 18, doc.y + 4);
      doc.moveTo(left, y).lineTo(left + pageWidth, y).strokeColor('#f3f4f6').stroke();
    }

    if (!items.length) {
      doc.fillColor(GREY).text('No billable items recorded on this invoice.', cols.desc + 6, y + 6);
      y += 24;
    }

    // ── Totals ──────────────────────────────────────────────────────────────
    y += 10;
    if (y > doc.page.height - 150) { doc.addPage(); y = 56; }
    const totalsX = left + pageWidth - 240;

    const row = (label, value, opts = {}) => {
      doc.fontSize(opts.big ? 11 : 9).font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fillColor(opts.colour || GREY)
        .text(label, totalsX, y, { width: 150, align: 'right' });
      doc.fillColor(opts.colour || '#111827')
        .text(money(value), totalsX + 150, y, { width: 90, align: 'right' });
      y += opts.big ? 20 : 15;
    };

    row('Subtotal', invoice.subtotal);
    if (Number(invoice.discount) > 0) row('Discount', -Number(invoice.discount));
    doc.moveTo(totalsX, y).lineTo(left + pageWidth, y).strokeColor('#e5e7eb').stroke();
    y += 8;
    row('Total', invoice.total, { bold: true, big: true, colour: DARK });
    row('Paid', invoice.amountPaid);
    row('Balance due', invoice.balance, { bold: true, colour: Number(invoice.balance) > 0 ? '#b91c1c' : '#15803d' });

    // ── Status + payment instruction ────────────────────────────────────────
    y += 8;
    const status = invoice.paymentStatus || 'UNPAID';
    const tone = status === 'PAID' ? '#15803d' : status === 'PART_PAID' ? '#b45309' : '#b91c1c';
    doc.roundedRect(left, y, 120, 24, 4).fill(tone);
    doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold')
      .text(status.replace('_', ' '), left, y + 7, { width: 120, align: 'center' });

    doc.fillColor(GREY).fontSize(8).font('Helvetica')
      .text('Payment is collected manually at the facility. This invoice is not an online payment request.',
        left + 132, y + 3, { width: pageWidth - 132 });
    if (invoice.paidAt) {
      doc.text(`Paid on ${formatDate(invoice.paidAt)}`, left + 132, doc.y, { width: pageWidth - 132 });
    }

    // ── Footer ──────────────────────────────────────────────────────────────
    const footerY = doc.page.height - doc.page.margins.bottom - 26;
    doc.moveTo(left, footerY).lineTo(left + pageWidth, footerY).strokeColor('#e5e7eb').stroke();
    doc.fontSize(7.5).fillColor(GREY)
      .text(`${facility?.name || ''}${facility?.licenseNumber ? ` - Licence ${facility.licenseNumber}` : ''}`,
        left, footerY + 7, { width: pageWidth / 2 });
    doc.text(`Invoice ${invoice.invoiceNumber} - generated ${formatDate(new Date())}`,
      left + pageWidth / 2, footerY + 7, { width: pageWidth / 2, align: 'right' });

    doc.end();
  });
}

module.exports = { buildInvoicePdf, money };
