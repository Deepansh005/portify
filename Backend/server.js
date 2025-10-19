
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const app = express();
const PORT = process.env.PORT || 8000;


app.use(cors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("Successfully connected to MongoDB Atlas!"))
    .catch(err => console.error("Error connecting to MongoDB:", err));

// User Schema (for VERIFIED users) 
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
});
const User = mongoose.model('User', userSchema);

// Unverified User Schema (for OTP process)
const unverifiedUserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    otp: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: '10m' } 
});
const UnverifiedUser = mongoose.model('UnverifiedUser', unverifiedUserSchema);

// Asset Schema 
const assetSchema = new mongoose.Schema({
    type: { type: String, required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true },
    price: { type: Number, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
});
const Asset = mongoose.model('Asset', assetSchema);


//  API Endpoints

//  Authentication Routes 

// POST /auth/register
app.post('/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;

        const existingVerifiedUser = await User.findOne({ email });
        if (existingVerifiedUser) {
            return res.status(400).json({ message: "This email is already registered." });
        }

        await UnverifiedUser.deleteOne({ email });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        const newUnverifiedUser = new UnverifiedUser({
            name,
            email,
            password: hashedPassword,
            otp
        });
        
        await newUnverifiedUser.save();
        console.log(`--- OTP for ${email}: ${otp} ---`);

        res.status(201).json({ message: `An OTP has been sent to ${email}. (Check the backend console)` });

    } catch (error) {
        res.status(500).json({ message: "Server error during registration.", error: error.message });
    }
});

// POST /auth/verify-otp
app.post('/auth/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;

        const unverifiedUser = await UnverifiedUser.findOne({ email });
        if (!unverifiedUser) {
            return res.status(400).json({ message: "Registration session has expired. Please sign up again." });
        }

        if (unverifiedUser.otp !== otp) {
            return res.status(400).json({ message: "Invalid OTP." });
        }
        
        const newUser = new User({
            name: unverifiedUser.name,
            email: unverifiedUser.email,
            password: unverifiedUser.password
        });

        await newUser.save();
        await UnverifiedUser.deleteOne({ email }); 

        console.log(`User ${email} has been verified and created.`);
        res.status(200).json({ message: "Email verified successfully! You can now log in." });

    } catch (error) {
        res.status(500).json({ message: "Server error during OTP verification.", error: error.message });
    }
});

// POST /auth/login
app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: "Invalid credentials or user not verified." });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: "Invalid credentials." });
        }

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'your_default_secret_key', { expiresIn: '1h' });
        
        console.log(`User logged in: ${user.email}`);
        res.json({
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
            },
        });

    } catch (error) {
        res.status(500).json({ message: "Server error during login.", error: error.message });
    }
});


// Asset Routes 
app.get('/assets', async (req, res) => {
    try {
        const assets = await Asset.find();
        res.json(assets.map(asset => {
            const assetObject = asset.toObject();
            assetObject.id = assetObject._id;
            delete assetObject._id;
            delete assetObject.__v;
            return assetObject;
        }));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});
//  Start the Server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
app.get('/ping', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

