const express = require('express');
const { authenticate, validate, errorHandler } = require('./middleware');
const routes = require('./routes');

const app = express();

// Middleware
app.use(express.json());
app.use(authenticate);
app.use(validate);

// Routes
app.use('/', routes);

// Error handling
app.use(errorHandler);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
