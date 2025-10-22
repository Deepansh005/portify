require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const nodemailer = require('nodemailer');

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
    username: { type: String, unique: true, sparse: true },
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

// Helper: create transporter (require real SMTP via env)
async function createTransporter() {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
        throw new Error('SMTP configuration missing. Please set SMTP_HOST, SMTP_USER and SMTP_PASS in your .env');
    }

    console.log('Creating SMTP transport with:', {
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT || 587,
        secure: process.env.SMTP_SECURE === 'true',
        user: process.env.SMTP_USER,
        from: process.env.SMTP_FROM
    });

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        logger: true,
        debug: true,
        tls: { rejectUnauthorized: true }
    });

    // Verify SMTP connection
    try {
        await transporter.verify();
        console.log('SMTP Connection verified successfully!');
        return transporter;
    } catch (error) {
        console.error('SMTP Connection failed:', {
            message: error.message,
            code: error.code,
            command: error.command,
            response: error.response,
            responseCode: error.responseCode
        });
        throw error;
    }
}

async function sendOtpEmail(to, otp, purpose = 'verification') {
    const transporter = await createTransporter();
    const subject = purpose === 'login' ? 'Your Portify login OTP' : 'Your Portify verification OTP';
    const text = `Your OTP for Portify (${purpose}) is: ${otp}. It expires in 10 minutes.`;
    const info = await transporter.sendMail({ from: process.env.SMTP_FROM || 'no-reply@portify.app', to, subject, text });
    console.log(`OTP email sent to ${to}. messageId=${info.messageId}`);
    return { info };
}


// --- API Routes ---

// Auth Routes 
// Auth routes
app.post('/auth/test-smtp', async (req, res) => {
    try {
        const transporter = await createTransporter();
        await transporter.verify();
        res.json({ 
            success: true, 
            message: 'SMTP configuration is valid',
            config: {
                host: process.env.SMTP_HOST,
                port: process.env.SMTP_PORT || 587,
                secure: process.env.SMTP_SECURE === 'true',
                user: process.env.SMTP_USER,
                from: process.env.SMTP_FROM
            }
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'SMTP configuration error',
            error: error.message,
            code: error.code
        });
    }
});

app.post('/auth/register', async (req, res) => {
    try {
        const { email, password, username } = req.body;
        if (!email || !password) return res.status(400).json({ message: 'Please enter all fields.' });
        
        // Check both email and username
        const existingUser = await User.findOne({ 
            $or: [
                { email },
                ...(username ? [{ username }] : [])
            ]
        });
        
        if (existingUser) {
            if (existingUser.email === email) {
                return res.status(400).json({ message: 'Email already registered.' });
            }
            return res.status(400).json({ message: 'Username already taken.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

        const newUser = new User({ 
            username: username || null,  
            email, 
            password: hashedPassword, 
            otp, 
            otpExpires, 
            isVerified: false 
        });

        try {
            await newUser.save();
            
            try {
                console.log('Attempting to send OTP email to:', email);
                const { info } = await sendOtpEmail(email, otp, 'register');
                console.log('Email sent successfully:', info.messageId);
                return res.status(201).json({ 
                    message: 'Registration initiated. Check email for OTP.'
                });
            } catch (emailErr) {
                console.error('Failed to send email:', emailErr);
                newUser.otp = undefined; 
                newUser.otpExpires = undefined; 
                await newUser.save();
                
                return res.status(500).json({ 
                    message: 'Account created but failed to send verification email. Please try logging in to receive a new OTP.',
                    error: process.env.NODE_ENV === 'development' ? emailErr.message : undefined
                });
            }
        } catch (saveErr) {
            if (saveErr.code === 11000) {
                const field = Object.keys(saveErr.keyPattern)[0];
                return res.status(400).json({ 
                    message: field === 'email' ? 'Email already registered.' : 'Username already taken.'
                });
            }
            throw saveErr;
        }
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ 
            message: 'Server error during registration.',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// verify OTP for register or login
app.post('/auth/verify-otp', async (req, res) => {
    try {
        const { email, otp, purpose } = req.body; 
        if (!email || !otp) return res.status(400).json({ message: 'Please provide email and OTP.' });
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: 'User not found.' });

        if (!user.otp || !user.otpExpires) return res.status(400).json({ message: 'No OTP was generated for this user.' });
        if (new Date() > user.otpExpires) return res.status(400).json({ message: 'OTP has expired.' });
        if (user.otp !== otp) return res.status(400).json({ message: 'Invalid OTP.' });

        // mark verified
        user.isVerified = true;
        user.otp = undefined; user.otpExpires = undefined; await user.save();

        const token = jwt.sign({ userId: user._id, email: user.email }, process.env.JWT_SECRET || 'your_default_secret_key_123!', { expiresIn: '24h' });
        return res.json({ message: 'OTP verified', token, user: { id: user._id, username: user.username, email: user.email } });
    } catch (err) {
        console.error('OTP verification error:', err);
        res.status(500).json({ message: 'Server error during OTP verification.' });
    }
});

app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ message: 'Please enter all fields.' });
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: 'Invalid credentials.' });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Invalid credentials.' });

        // generate/send login OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpires = new Date(Date.now() + 10 * 60 * 1000);
        user.otp = otp; user.otpExpires = otpExpires; await user.save();
        try {
            const { info } = await sendOtpEmail(email, otp, 'login');
            return res.json({ message: 'Login OTP sent. Check your email.' });
        } catch (emailErr) {
            console.error('login OTP send failed', emailErr);
            user.otp = undefined; user.otpExpires = undefined; await user.save();
            return res.status(500).json({ message: 'Failed to send login OTP.' });
        }
    } catch (err) {
        console.error(err);
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
