const express = require('express');
const { getJob } = require('../data/jobStore');

const router = express.Router();

router.get('/validation/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'No job found with that ID.' });
  }
  res.status(200).json(job);
});

module.exports = router;