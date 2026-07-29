const express = require('express');
const { classifyQuery } = require('../services/ai/rag/queryRouter');
const { handleStructuredQuery } = require('../services/ai/rag/structuredHandler');
const { handleSemanticQuery } = require('../services/ai/rag/semanticHandler');
const { getHistory, appendTurn } = require('../data/conversationStore');
const { logQuery } = require('../data/queryLogStore');

const router = express.Router();

router.post('/assistant/query', async (req, res) => {
  const { sessionId, message } = req.body;

  if (!sessionId || !message) {
    return res.status(400).json({ error: 'Both sessionId and message are required.' });
  }

  try {
    const history = getHistory(sessionId);
    const route = classifyQuery(message);

    const result = route === 'structured'
      ? await handleStructuredQuery(message, history)
      : await handleSemanticQuery(message, history);

    appendTurn(sessionId, 'user', message);
    appendTurn(sessionId, 'assistant', result.answer);
    logQuery({ sessionId, message, route, sources: result.sources });

    res.status(200).json(result);
  } catch (err) {
    console.error('Assistant query failed:', err);
    res.status(500).json({ error: 'Could not process that question right now.' });
  }
});

module.exports = router;