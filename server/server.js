require('dotenv').config();
const express = require('express');
const path = require('path');
const routes = require('./routes');

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Attendance server running at http://localhost:${PORT}`);
});
