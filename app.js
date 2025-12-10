require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const routes = require('./routes');
const { seedAdmin } = require('./utils');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(cors());

mongoose.connect(process.env.DB_URI)
    .then(() => {
        console.log('MongoDB Connected');
        seedAdmin();
    })
    .catch(err => console.error('MongoDB connection error:', err));

app.use('/api', routes);

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ success: false, message: 'Something went wrong', data: err.message });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});