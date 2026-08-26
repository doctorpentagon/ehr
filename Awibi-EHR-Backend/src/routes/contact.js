const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { sendMail } = require('../utils/mailer');

const contactLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: { error: 'Too many messages sent — try again later' }, standardHeaders: true, legacyHeaders: false });

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// POST /v1/contact — public, no auth required
router.post('/', contactLimiter, async (req, res, next) => {
  try {
    const { firstName, lastName, email, phone, subject, message } = req.body;
    if (!firstName || !email || !message) {
      return res.status(400).json({ error: 'firstName, email, and message are required.' });
    }
    if (!/^\S+@\S+\.\S+$/.test(String(email)) || String(email).length > 254) {
      return res.status(400).json({ error: 'Enter a valid email address.', field: 'email' });
    }
    if (String(firstName).length > 80 || String(lastName || '').length > 80 || String(phone || '').length > 40) {
      return res.status(400).json({ error: 'One of the contact details is too long.' });
    }
    if (String(subject || '').length > 120 || String(message).length > 5000) {
      return res.status(400).json({ error: 'Keep the subject under 120 characters and the message under 5,000 characters.' });
    }

    const adminEmail = process.env.MAIL_USERNAME || 'awibihealth@gmail.com';

    await sendMail({
      to: adminEmail,
      subject: `[Awibi Contact] ${subject || 'General Inquiry'} — ${firstName} ${lastName || ''}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#0B1F66">New contact form submission</h2>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#666;width:120px">Name</td><td style="padding:6px 0;font-weight:600">${esc(firstName)} ${esc(lastName || '')}</td></tr>
            <tr><td style="padding:6px 0;color:#666">Email</td><td style="padding:6px 0"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
            <tr><td style="padding:6px 0;color:#666">Phone</td><td style="padding:6px 0">${esc(phone || '—')}</td></tr>
            <tr><td style="padding:6px 0;color:#666">Subject</td><td style="padding:6px 0">${esc(subject || '—')}</td></tr>
          </table>
          <hr style="margin:16px 0;border:none;border-top:1px solid #e5e7eb"/>
          <h3 style="color:#374151;margin-bottom:8px">Message</h3>
          <p style="color:#4b5563;white-space:pre-wrap;line-height:1.6">${esc(message)}</p>
          <hr style="margin:16px 0;border:none;border-top:1px solid #e5e7eb"/>
          <p style="font-size:12px;color:#9ca3af">Sent via Awibi EHR contact form · ${new Date().toISOString()}</p>
        </div>
      `,
    });

    // A confirmation failure must not erase the fact that the Awibi inbox has
    // already received the enquiry. Log it separately and return the truthful
    // delivery result to the sender.
    let confirmationSent = true;
    try {
      await sendMail({
        to: email,
        subject: `We received your message — Awibi Health`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
            <h2 style="color:#0B1F66">Thanks for reaching out, ${esc(firstName)}!</h2>
            <p style="color:#4b5563;line-height:1.6">We've received your message and will get back to you within 24–48 hours.</p>
            <p style="color:#4b5563;line-height:1.6">In the meantime, you can also reach us at:</p>
            <ul style="color:#4b5563">
              <li>📞 <a href="tel:+2348177790294">+2348177790294</a></li>
              <li>💬 <a href="https://wa.me/2348177790294">WhatsApp</a></li>
            </ul>
            <p style="color:#9ca3af;font-size:12px;margin-top:24px">Awibi Health — Simplifying Healthcare Records in Africa</p>
          </div>
        `,
      });
    } catch (confirmationError) {
      confirmationSent = false;
      console.error('[contact] confirmation email error:', confirmationError.message);
    }

    res.json({ success: true, confirmationSent, message: 'Message delivered to the Awibi team. We\'ll be in touch soon!' });
  } catch (err) {
    console.error('[contact] email error:', err.message);
    res.status(503).json({
      error: 'We could not deliver your message just now. Please email awibihealth@gmail.com or use WhatsApp.',
    });
  }
});

module.exports = router;
