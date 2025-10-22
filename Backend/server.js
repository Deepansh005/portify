require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors({ origin: true }));
app.use(express.json());

// Database Connection
const MONGO_CONN = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/portifydb';
console.log('Connecting to MongoDB at', MONGO_CONN.startsWith('mongodb+srv://') ? 'MongoDB Atlas (srv)' : MONGO_CONN);
mongoose.connect(MONGO_CONN)
    .then(() => console.log('MongoDB connected successfully.'))
    .catch(err => console.error('MongoDB connection error:', err));

// Mongoose Schemas

// User Schema 
const userSchema = new mongoose.Schema({
    username: { type: String },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    otp: { type: String },
    otpExpires: { type: Date },
    isVerified: { type: Boolean, default: false }
}, { timestamps: true });
const User = mongoose.model('User', userSchema, 'users');

// Asset Schema 
const assetSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true },
    price: { type: Number, required: true },
}, { timestamps: true });

const Asset = mongoose.model('Asset', assetSchema, 'assets');


// Authentication Middleware 
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) {
        return res.status(401).json({ message: "No token provided." }); 
    }

    jwt.verify(token, process.env.JWT_SECRET || 'your_default_secret_key_123!', (err, payload) => {
        if (err) return res.status(403).json({ message: 'Token is invalid.' });
        req.userId = payload.userId || payload.id || payload._id || null;
        next();
    });
}


// --- API Routes ---

// Auth Routes 
// Auth routes
app.post('/auth/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: 'Please enter all fields.' });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpires = new Date(Date.now() + 10 * 60 * 1000); 

        const newUser = new User({
            username: req.body.username || '',
            email,
            password: hashedPassword,
            otp,
            otpExpires,
            isVerified: false
        });
        await newUser.save();

        console.log(`Generated OTP for ${email}: ${otp}`);

        res.status(201).json({
            message: 'Registration successful! Please verify your email with the OTP.',
            user: { id: newUser._id, username: newUser.username, email: newUser.email },
            otp 
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error during registration.' });
    }
});

app.post('/auth/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) {
            return res.status(400).json({ message: 'Please provide email and OTP.' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        if (user.isVerified) {
            return res.status(400).json({ message: 'User is already verified.' });
        }

        if (!user.otp || !user.otpExpires) {
            return res.status(400).json({ message: 'No OTP was generated for this user.' });
        }

        if (new Date() > user.otpExpires) {
            return res.status(400).json({ message: 'OTP has expired.' });
        }

        if (user.otp !== otp) {
            return res.status(400).json({ message: 'Invalid OTP.' });
        }

        user.isVerified = true;
        user.otp = undefined;
        user.otpExpires = undefined;
        await user.save();

        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'your_default_secret_key_123!', { expiresIn: '24h' });
        res.json({
            message: 'Email verified successfully!',
            token,
            user: { id: user._id, username: user.username, email: user.email }
        });
    } catch (error) {
        console.error('OTP verification error:', error);
        res.status(500).json({ message: 'Server error during OTP verification.' });
    }
});

app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: 'Please enter all fields.' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'Invalid credentials.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid credentials.' });
        }

        const token = jwt.sign({ userId: user._id, email: user.email }, process.env.JWT_SECRET || 'your_default_secret_key_123!', { expiresIn: '24h' });
        res.json({ message: 'Logged in successfully!', token, user: { id: user._id, username: user.username, email: user.email } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error during login.' });
    }
});
// Asset API Routes 
// GET /assets 
app.get('/assets', authenticateToken, async (req, res) => {
    try {
        const assets = await Asset.find({ userId: req.userId });
        // return simple array
        res.json(assets.map(a => ({ id: a._id, type: a.type, name: a.name, quantity: a.quantity, price: a.price })));
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error fetching assets.' });
    }
});

// POST /assets - create
app.post('/assets', authenticateToken, async (req, res) => {
    try {
        const { type, name, quantity, price } = req.body;
        if (!type || !name || quantity == null || price == null) return res.status(400).json({ message: 'Invalid asset data' });
        const a = new Asset({ userId: req.userId, type, name, quantity, price });
        const saved = await a.save();
        res.status(201).json({ id: saved._id, type: saved.type, name: saved.name, quantity: saved.quantity, price: saved.price });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error creating asset.' });
    }
});

// PUT /assets/:id - update
app.put('/assets/:id', authenticateToken, async (req, res) => {
    try {
        const id = req.params.id;
        const updates = {};
        ['type','name','quantity','price'].forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
        const asset = await Asset.findOneAndUpdate({ _id: id, userId: req.userId }, updates, { new: true });
        if (!asset) return res.status(404).json({ message: 'Asset not found or forbidden' });
        res.json({ id: asset._id, type: asset.type, name: asset.name, quantity: asset.quantity, price: asset.price });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error updating asset.' });
    }
});

// DELETE /assets/:id
app.delete('/assets/:id', authenticateToken, async (req, res) => {
    try {
        const id = req.params.id;
        const deleted = await Asset.findOneAndDelete({ _id: id, userId: req.userId });
        if (!deleted) return res.status(404).json({ message: 'Asset not found or forbidden' });
        res.json({ message: 'Asset deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error deleting asset.' });
    }
});

// Health check and root routes
app.get('/ping', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/', (req, res) => {
    res.send('Portify backend is running');
});

function listRoutes() {
    const routes = [];
    if (!app._router) return routes;
    app._router.stack.forEach(mw => {
        if (mw.route) {
            const methods = Object.keys(mw.route.methods).join(',').toUpperCase();
            routes.push(`${methods} ${mw.route.path}`);
        } else if (mw.name === 'router' && mw.handle && mw.handle.stack) {
            mw.handle.stack.forEach(r => {
                if (r.route) {
                    const methods = Object.keys(r.route.methods).join(',').toUpperCase();
                    routes.push(`${methods} ${r.route.path}`);
                }
            });
        }
    });
    return routes;
}


// --- Server Start ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
