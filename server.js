const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const DERIV_API_TOKEN = process.env.DERIV_API_TOKEN || '';
const APP_ID = process.env.APP_ID || '1089';

app.use(cors());
app.use(express.json());

// Simbolos validos de Deriv para indices sinteticos
const SYMBOLS = {
  'CRASH600': 'CRASH_600',
  'CRASH_600': 'CRASH_600',
  'crash600': 'CRASH_600',
  'STEP': 'stpRNG',
  'STEPINDEX': 'stpRNG',
  'stpRNG': 'stpRNG'
};

function getDerivTick(rawSymbol) {
  return new Promise((resolve, reject) => {
    const symbol = SYMBOLS[rawSymbol] || rawSymbol;

    const timeout = setTimeout(() => {
      try { ws.close(); } catch(e) {}
      reject(new Error('Timeout: Deriv no respondio en 10 segundos'));
    }, 10000);

    const ws = new WebSocket(
      `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`
    );

    let authorized = false;

    ws.on('open', () => {
      if (DERIV_API_TOKEN) {
        ws.send(JSON.stringify({ authorize: DERIV_API_TOKEN }));
      } else {
        ws.send(JSON.stringify({ ticks: symbol, subscribe: 0 }));
      }
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());

      if (msg.msg_type === 'authorize' && !authorized) {
        authorized = true;
        ws.send(JSON.stringify({ ticks: symbol, subscribe: 0 }));
      }

      if (msg.msg_type === 'tick') {
        clearTimeout(timeout);
        ws.close();
        resolve({
          symbol: msg.tick.symbol,
          price: msg.tick.quote,
          bid: msg.tick.bid || msg.tick.quote,
          ask: msg.tick.ask || msg.tick.quote,
          timestamp: new Date(msg.tick.epoch * 1000).toISOString(),
          pip_size: msg.tick.pip_size
        });
      }

      if (msg.error) {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(`Error Deriv: ${msg.error.message} (codigo: ${msg.error.code})`));
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket error: ${err.message}`));
    });
  });
}

// GET /tick?symbol=CRASH_600
app.get('/tick', async (req, res) => {
  const symbol = req.query.symbol || 'CRASH_600';
  try {
    const tick = await getDerivTick(symbol);
    res.json({
      success: true,
      instrument: symbol,
      data: tick,
      source: 'Deriv API'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      instrument: symbol,
      error: err.message
    });
  }
});

// GET /price/crash600
app.get('/price/crash600', async (req, res) => {
  try {
    const tick = await getDerivTick('CRASH_600');
    res.json({ success: true, instrument: 'Crash 600 Index', data: tick });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /price/stepindex
app.get('/price/stepindex', async (req, res) => {
  try {
    const tick = await getDerivTick('stpRNG');
    res.json({ success: true, instrument: 'Step Index', data: tick });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /prices - Obtiene ambos precios simultaneamente
app.get('/prices', async (req, res) => {
  try {
    const [crash600, stepIndex] = await Promise.allSettled([
      getDerivTick('CRASH_600'),
      getDerivTick('stpRNG')
    ]);
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      crash_600: crash600.status === 'fulfilled' ? crash600.value : { error: crash600.reason.message },
      step_index: stepIndex.status === 'fulfilled' ? stepIndex.value : { error: stepIndex.reason.message }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /health
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Deriv WebSocket-REST Bridge',
    version: '1.0.0',
    endpoints: ['/tick?symbol=CRASH_600', '/price/crash600', '/price/stepindex', '/prices'],
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`Deriv Bridge activo en puerto ${PORT}`);
  console.log(`Endpoints: /health | /tick | /price/crash600 | /price/stepindex | /prices`);
});
