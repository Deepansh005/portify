// 1. Import necessary libraries
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config(); // Loads environment variables from .env file

// Enable mongoose debug to log queries (helpful during development)
mongoose.set('debug', true);

// 2. Initialize Express App
const app = express();
const PORT = process.env.PORT || 8000;

// 3. Middleware
app.use(cors({
    origin: ['http://localhost:5000', 'http://127.0.0.1:5000', 'http://localhost:5500', 'http://127.0.0.1:5500'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));
app.use(express.json()); // Allows the server to understand JSON data

// 4. Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
    // modern drivers no longer need these options; leaving empty options object
})
.then(() => console.log("Successfully connected to MongoDB Atlas!"))
.catch(err => {
    console.error("Error connecting to MongoDB:", err.message);
    process.exit(1);
});

// 'open' event is a reliable place to inspect the native DB after connection
mongoose.connection.once('open', async () => {
    try {
        const db = mongoose.connection.db;
        console.log('mongoose connection open. readyState=', mongoose.connection.readyState);
        console.log('Database name (native):', db.databaseName);
        const cols = await db.listCollections().toArray();
        console.log('Collections (native):', cols.map(c => c.name));
    } catch (e) {
        console.error('Error during connection open debug:', e && e.message ? e.message : e);
    }
});

// 5. Define Schemas and Models
// User Schema
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    // OTP fields for email/phone verification
    otp: { type: String },
    otpExpires: { type: Date },
    isVerified: { type: Boolean, default: false }
});

// Asset Schema with user reference
const assetSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true },
    price: { type: Number, required: true },
});

// The 'User' and 'Asset' models will interact with explicit collections in the database.
// Specifying the collection name ensures documents land where the Data Explorer expects them.
const User = mongoose.model('User', userSchema, 'users');
const Asset = mongoose.model('Asset', assetSchema, 'assets');

// Middleware to verify JWT token
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Authentication token required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = await User.findById(decoded.userId);
        next();
    } catch (error) {
        return res.status(403).json({ message: 'Invalid token' });
    }
};

// --- 6. Authentication Endpoints ---

// User Registration
app.post('/auth/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({ 
            $or: [{ email }, { username }] 
        });
        
        if (existingUser) {
            return res.status(400).json({ 
                message: 'User with this email or username already exists' 
            });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Generate 6-digit OTP and expiry (10 minutes)
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Normalize email to lowercase to avoid duplicates and ease lookups
        const normalizedEmail = email.trim().toLowerCase();

        // Create new user with OTP fields
        const user = new User({
            username: username.trim(),
            email: normalizedEmail,
            password: hashedPassword,
            otp,
            otpExpires,
            isVerified: false
        });

        const savedUser = await user.save();
        console.log(`New user saved: id=${savedUser._id} email=${savedUser.email}`);

        // Verify the document exists by querying the raw collection via the native driver
        try {
            const rawDoc = await mongoose.connection.db.collection('users').findOne({ _id: savedUser._id });
            console.log('Verified raw document from DB:', rawDoc ? 'FOUND' : 'NOT FOUND', rawDoc ? { _id: rawDoc._id, email: rawDoc.email } : null);
        } catch (dbErr) {
            console.error('Error querying raw collection after save:', dbErr.message);
        }

        // NOTE: In production you would send OTP via email/SMS. For now return it in response for testing.
        res.status(201).json({
            message: 'User registered successfully. OTP sent (development).',
            otp,
            otpExpires,
            user: {
                id: savedUser._id,
                username: savedUser.username,
                email: savedUser.email
            }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Verify OTP endpoint
app.post('/auth/verify-otp', async (req, res) => {
    try {
        let { email, otp } = req.body;
        if (email) email = email.trim().toLowerCase();
        if (!email || !otp) return res.status(400).json({ message: 'Email and OTP are required' });

        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (user.isVerified) return res.status(400).json({ message: 'User already verified' });

        if (!user.otp || !user.otpExpires) return res.status(400).json({ message: 'No OTP set for user' });

        if (user.otp !== otp) return res.status(400).json({ message: 'Invalid OTP' });

        if (user.otpExpires < new Date()) return res.status(400).json({ message: 'OTP expired' });

        user.isVerified = true;
        user.otp = undefined;
        user.otpExpires = undefined;
        await user.save();

        // Issue JWT after verification
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '24h' });

        res.json({ message: 'User verified successfully', token });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// User Login
app.post('/auth/login', async (req, res) => {
    try {
        let { email, password } = req.body;
        if (email) email = email.trim().toLowerCase();

    // Find user (emails stored normalized)
    const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }

            // Ensure user is verified
            if (!user.isVerified) {
                return res.status(403).json({ message: 'Email not verified. Please verify OTP before logging in.' });
            }

        // Verify password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }

        // Create JWT token
        const token = jwt.sign(
            { userId: user._id }, 
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            message: 'Logged in successfully',
            token,
            user: {
                id: user._id,
                username: user.username,
                email: user.email
            }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// --- 7. Protected Asset Endpoints ---

// GET all assets for authenticated user
app.get('/assets', authenticateToken, async (req, res) => {
    try {
        const assets = await Asset.find({ userId: req.user._id });
        res.json(assets);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// POST a new asset
app.post('/assets', authenticateToken, async (req, res) => {
    const asset = new Asset({
        userId: req.user._id,
        type: req.body.type,
        name: req.body.name,
        quantity: req.body.quantity,
        price: req.body.price
    });

    try {
        const newAsset = await asset.save();
        console.log("Added new asset:", newAsset.name);
        // Rename _id to id for frontend compatibility
        const responseAsset = newAsset.toObject();
        responseAsset.id = responseAsset._id;
        delete responseAsset._id;
        delete responseAsset.__v;
        res.status(201).json(responseAsset);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// PUT (update) an existing asset by ID
app.put('/assets/:id', authenticateToken, async (req, res) => {
    try {
        const updatedAsset = await Asset.findByIdAndUpdate(
            req.params.id, 
            req.body, 
            { new: true } // This option returns the updated document
        );
        if (!updatedAsset) return res.status(404).json({ message: "Asset not found" });
        
        console.log("Updated asset:", updatedAsset.name);
        const responseAsset = updatedAsset.toObject();
        responseAsset.id = responseAsset._id;
        delete responseAsset._id;
        delete responseAsset.__v;
        res.json(responseAsset);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// DELETE an asset by ID
app.delete('/assets/:id', authenticateToken, async (req, res) => {
    try {
        const deletedAsset = await Asset.findByIdAndDelete(req.params.id);
        if (!deletedAsset) return res.status(404).json({ message: "Asset not found" });

        console.log("Deleted asset:", deletedAsset.name);
        res.json({ message: "Asset deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});


// 7. Start the Server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

// Debug endpoint: lists collections and counts (not for production)
app.get('/debug/collections', async (req, res) => {
    try {
        const db = mongoose.connection.db;
        const cols = await db.listCollections().toArray();
        const result = {};
        for (const c of cols) {
            const count = await db.collection(c.name).countDocuments();
            result[c.name] = count;
        }
        res.json({ db: db.databaseName, collections: result });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});