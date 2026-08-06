const express = require('express');
const router = express.Router();

router.use('/auth', require('./auth'));
router.use('/overview', require('./overview'));
router.use('/patients', require('./patients'));
router.use('/cases', require('./cases'));
router.use('/appointments', require('./appointments'));
router.use('/lab', require('./lab'));
router.use('/nursing', require('./nursing'));
router.use('/platform', require('./platform'));
router.use('/households', require('./households'));
router.use('/insurance', require('./insurance'));
router.use('/emergency', require('./emergency'));
router.use('/orders',    require('./orders'));
router.use('/bookings',  require('./bookings'));
router.use('/inquiries', require('./inquiries'));
router.use('/messages',  require('./messages'));
router.use('/alerts',    require('./alerts'));
router.use('/scout',     require('./scout'));
router.use('/encounter-types', require('./encounterTypes').router);
// Unauthenticated clinic pages and booking intake.
router.use('/public',    require('./public'));
router.use('/departments', require('./departments'));
router.use('/staff', require('./staff'));
router.use('/billing', require('./billing'));
router.use('/subscriptions', require('./subscriptions'));
router.use('/admissions', require('./admissions'));
router.use('/reports', require('./reports'));
router.use('/settings', require('./settings'));
router.use('/analytics', require('./overview')); // alias — frontend calls /analytics/summary
router.use('/affiliates', require('./affiliates'));
router.use('/uploads',    require('./uploads'));
router.use('/ocr',        require('./ocr'));
router.use('/paystack',   require('./paystack'));
router.use('/consent',    require('./consent'));

router.use('/contact',   require('./contact'));

router.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

module.exports = router;
